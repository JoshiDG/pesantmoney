import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { Tag } from "../tags/types";
import { Transfer } from "../transfers/types";
import { TransactionsGrid } from "./TransactionsGrid";
import {
  ColumnVisibility,
  DEFAULT_COLUMN_VISIBILITY,
  Transaction,
  TransactionFields,
  TransactionWithAccount,
} from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { CustomSelect } from "../ui/Dropdown";

interface AllTransactionsScreenProps {
  // Pre-selects the Account filter, e.g. when opened from an Account row
  // click on the Accounts screen (#50/#51). `null` shows every Account.
  initialAccountId: number | null;
}

// The all-Accounts Transactions view (#51): defaults to every Transaction
// across every Account, with a filter to narrow to a single Account. All
// existing per-Transaction interactions (inline edit, categorize, Tag,
// link/unlink Transfer, mark Hidden, delete, bulk category assignment) are
// reused unchanged via TransactionsGrid -- this screen only adds the
// cross-Account data-fetch and the Account filter/badge on top of it.
export function AllTransactionsScreen({ initialAccountId }: AllTransactionsScreenProps) {
  const [transactions, setTransactions] = useState<TransactionWithAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [tagsByTransactionId, setTagsByTransactionId] = useState<Record<number, Tag[]>>({});
  const [accountFilter, setAccountFilter] = useState<number | null>(initialAccountId);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  // Hidden transactions (#70): off by default. `list_all_transactions`
  // has no `include_hidden` param (unlike the per-Account
  // `list_visible_transactions`) -- see the "Hidden transactions" section
  // of #67's Implementation Decisions, which scopes `list_all_with_accounts`
  // to intentionally not filter hidden rows (that's a Reports-specific
  // exclusion, not a Transactions-view one). So this screen filters
  // client-side over the already-fetched, already-`hidden`-carrying rows,
  // same as its existing Account-filter logic below.
  const [showHidden, setShowHidden] = useState(false);
  const { confirm } = useConfirmation();

  // Keeps the filter in sync with the Account the caller pre-selected, even
  // if this screen is already mounted showing a different filter (e.g. the
  // user clicks a different Account row on the Accounts screen without
  // first navigating away from Transactions).
  useEffect(() => {
    setAccountFilter(initialAccountId);
  }, [initialAccountId]);

  async function refresh() {
    try {
      const [transactionList, categoryList, accountList, transferList] = await Promise.all([
        invoke<TransactionWithAccount[]>("list_all_transactions"),
        invoke<Category[]>("list_categories"),
        invoke<Account[]>("list_accounts"),
        invoke<Transfer[]>("list_transfers"),
      ]);
      setTransactions(transactionList);
      setCategories(categoryList);
      setAccounts(accountList);
      setTransfers(transferList);

      // Tags are only queryable per-Account today (#38); merge each
      // Account's map into one so the grid can look Tags up by Transaction
      // id regardless of which Account a row belongs to.
      const tagMaps = await Promise.all(
        accountList.map((account) =>
          invoke<Record<number, Tag[]>>("list_tags_for_account", { account_id: account.id }),
        ),
      );
      setTagsByTransactionId(Object.assign({}, ...tagMaps));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Column Management (#68): one global config for the whole app, so it's
  // loaded once on mount, independent of the Account filter.
  useEffect(() => {
    invoke<{ transaction_column_visibility: ColumnVisibility }>("get_settings")
      .then((settings) => setColumnVisibility(settings.transaction_column_visibility))
      .catch((err) => setError(String(err)));
  }, []);

  async function handleColumnVisibilityChange(next: ColumnVisibility) {
    setColumnVisibility(next);
    try {
      await invoke("update_transaction_column_visibility", {
        transaction_column_visibility: next,
      });
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUpdate(id: number, fields: TransactionFields) {
    try {
      await invoke("update_transaction", { id, ...fields });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Bulk Category assignment for the grid's multi-row selection -- same
  // approach as the per-Account screen: reuse `update_transaction` per
  // selected row rather than introducing a new backend command.
  async function handleBulkAssignCategory(ids: number[], categoryId: number | null) {
    try {
      await Promise.all(
        ids.map((id) => {
          const transaction = transactions.find((t) => t.id === id);
          if (!transaction) return Promise.resolve();
          return invoke("update_transaction", {
            id,
            date: transaction.date,
            amount_cents: transaction.amount_cents,
            description: transaction.description,
            category_id: categoryId,
          });
        }),
      );
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(transaction: Transaction) {
    const confirmed = await confirm({
      title: "Delete Transaction",
      message: `Delete this transaction ("${transaction.description}")? This cannot be undone.`,
      confirmLabel: "Delete Transaction",
    });
    if (!confirmed) {
      return;
    }
    try {
      await invoke("delete_transaction", { id: transaction.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleLink(fromTransactionId: number, toTransactionId: number) {
    try {
      await invoke("link_transfer", {
        from_transaction_id: fromTransactionId,
        to_transaction_id: toTransactionId,
      });
      setLinkingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleUnlink(transfer: Transfer) {
    try {
      await invoke("unlink_transfer", { id: transfer.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Hidden transactions (#70): same pattern as onUpdate/onDelete above --
  // call the already-existing `set_transaction_hidden` command, then
  // refresh.
  async function handleSetHidden(transaction: Transaction, hidden: boolean) {
    try {
      await invoke("set_transaction_hidden", { id: transaction.id, hidden });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  const linkedTransactionIds = new Set(
    transfers.flatMap((transfer) => [transfer.from_transaction_id, transfer.to_transaction_id]),
  );
  const transferByTransactionId = new Map<number, Transfer>();
  for (const transfer of transfers) {
    transferByTransactionId.set(transfer.from_transaction_id, transfer);
    transferByTransactionId.set(transfer.to_transaction_id, transfer);
  }

  const filteredTransactions: Transaction[] = transactions
    .filter((t) => accountFilter == null || t.account_id === accountFilter)
    .filter((t) => showHidden || !t.hidden);

  // TransactionsGrid now owns Account-column suppression itself (#68):
  // it force-hides the Account column whenever the transactions it's given
  // resolve to a single distinct Account, generalizing what this screen
  // used to compute locally as `showAccountBadge`.

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Transactions</h2>
          <div className="account-title-meta">Every transaction across every account</div>
        </div>
        <div className="content-header-actions">
          <label>
            Account{" "}
            <CustomSelect
              ariaLabel="Filter by account"
              options={[
                { value: "all", label: "All accounts" },
                ...accounts.map((account) => ({ value: String(account.id), label: account.name })),
              ]}
              value={accountFilter == null ? "all" : String(accountFilter)}
              onChange={(val) => setAccountFilter(val === "all" ? null : Number(val))}
            />
          </label>
          <label className="show-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.currentTarget.checked)}
            />
            Show hidden
          </label>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="ledger-container">
        <TransactionsGrid
          transactions={filteredTransactions}
          categories={categories}
          accounts={accounts}
          tagsByTransactionId={tagsByTransactionId}
          linkedTransactionIds={linkedTransactionIds}
          transferByTransactionId={transferByTransactionId}
          linkingId={linkingId}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={handleColumnVisibilityChange}
          onStartLink={setLinkingId}
          onCancelLink={() => setLinkingId(null)}
          onLink={handleLink}
          onUnlink={handleUnlink}
          onUpdate={handleUpdate}
          onBulkAssignCategory={handleBulkAssignCategory}
          onDelete={handleDelete}
          onSetHidden={handleSetHidden}
        />
      </div>
    </section>
  );
}

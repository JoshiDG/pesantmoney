import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { Tag } from "../tags/types";
import { Transfer } from "../transfers/types";
import { TransactionsGrid } from "./TransactionsGrid";
import { Transaction, TransactionFields, TransactionWithAccount } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";

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

  const linkedTransactionIds = new Set(
    transfers.flatMap((transfer) => [transfer.from_transaction_id, transfer.to_transaction_id]),
  );
  const transferByTransactionId = new Map<number, Transfer>();
  for (const transfer of transfers) {
    transferByTransactionId.set(transfer.from_transaction_id, transfer);
    transferByTransactionId.set(transfer.to_transaction_id, transfer);
  }

  const filteredTransactions =
    accountFilter == null ? transactions : transactions.filter((t) => t.account_id === accountFilter);

  // Only show the Account badge once more than one Account is actually
  // represented in the current view (per #51's acceptance criteria) --
  // narrowing to a single Account should read exactly like today's
  // per-Account ledger, badge-free.
  const distinctAccountCount = new Set(filteredTransactions.map((t) => t.account_id)).size;
  const showAccountBadge = distinctAccountCount > 1;
  const gridTransactions: Transaction[] = showAccountBadge
    ? filteredTransactions
    : filteredTransactions.map(({ account_name: _accountName, ...rest }) => rest);

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
            <select
              aria-label="Filter by account"
              value={accountFilter == null ? "all" : String(accountFilter)}
              onChange={(e) =>
                setAccountFilter(e.currentTarget.value === "all" ? null : Number(e.currentTarget.value))
              }
            >
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="ledger-container">
        <TransactionsGrid
          transactions={gridTransactions}
          categories={categories}
          accounts={accounts}
          tagsByTransactionId={tagsByTransactionId}
          linkedTransactionIds={linkedTransactionIds}
          transferByTransactionId={transferByTransactionId}
          linkingId={linkingId}
          onStartLink={setLinkingId}
          onCancelLink={() => setLinkingId(null)}
          onLink={handleLink}
          onUnlink={handleUnlink}
          onUpdate={handleUpdate}
          onBulkAssignCategory={handleBulkAssignCategory}
          onDelete={handleDelete}
        />
      </div>
    </section>
  );
}

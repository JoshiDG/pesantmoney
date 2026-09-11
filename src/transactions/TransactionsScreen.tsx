import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account, ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { Category } from "../categories/types";
import { Merchant } from "../merchants/types";
import { Tag } from "../tags/types";
import { Transfer } from "../transfers/types";
import { TransactionForm } from "./TransactionForm";
import { TransactionsGrid } from "./TransactionsGrid";
import { ColumnVisibility, DEFAULT_COLUMN_VISIBILITY, formatCents, Transaction, TransactionFields } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { useCsvExport } from "../ui/useCsvExport";

interface TransactionsScreenProps {
  account: Account;
  onBack: () => void;
  onImport: () => void;
}

// Recurring and Holdings are no longer tabs here -- Recurring Item and
// Holding management moved to their own top-level all-Accounts screens (#52,
// #53); this ledger is purely the Transaction grid now.
type LedgerView = "transactions";

export function TransactionsScreen({ account, onBack, onImport }: TransactionsScreenProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [tagsByTransactionId, setTagsByTransactionId] = useState<Record<number, Tag[]>>({});
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [allMerchants, setAllMerchants] = useState<Merchant[]>([]);
  const [balanceCents, setBalanceCents] = useState(0);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerView, setLedgerView] = useState<LedgerView>("transactions");
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY);
  // Hidden transactions (#70): off by default, so the grid keeps excluding
  // hidden Transactions exactly like before this toggle existed.
  const [showHidden, setShowHidden] = useState(false);
  const { confirm } = useConfirmation();
  const { exportCsv, exporting: exportingCsv, result: csvExportResult, error: csvExportError } = useCsvExport();

  const linkedTransactionIds = new Set(
    transfers.flatMap((transfer) => [transfer.from_transaction_id, transfer.to_transaction_id]),
  );
  const transferByTransactionId = new Map<number, Transfer>();
  for (const transfer of transfers) {
    transferByTransactionId.set(transfer.from_transaction_id, transfer);
    transferByTransactionId.set(transfer.to_transaction_id, transfer);
  }

  async function refresh() {
    try {
      const [
        transactionList,
        balance,
        categoryList,
        accountList,
        transferList,
        tagsByTransaction,
        tagList,
        merchantList,
      ] = await Promise.all([
        invoke<Transaction[]>("list_visible_transactions", {
          account_id: account.id,
          include_hidden: showHidden,
        }),
        invoke<number>("account_balance_cents", { account_id: account.id }),
        invoke<Category[]>("list_categories"),
        invoke<Account[]>("list_accounts"),
        invoke<Transfer[]>("list_transfers"),
        invoke<Record<number, Tag[]>>("list_tags_for_account", { account_id: account.id }),
        invoke<Tag[]>("list_tags"),
        invoke<Merchant[]>("list_merchants"),
      ]);
      setTransactions(transactionList);
      setBalanceCents(balance);
      setCategories(categoryList);
      setAccounts(accountList);
      setTransfers(transferList);
      setTagsByTransactionId(tagsByTransaction);
      setAllTags(tagList ?? []);
      setAllMerchants(merchantList ?? []);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    setLedgerView("transactions");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, showHidden]);

  // Column Management (#68): one global config for the whole app, so it's
  // loaded once on mount rather than per-Account like the rest of this
  // screen's data.
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

  async function handleCreate(fields: TransactionFields) {
    try {
      await invoke("create_transaction", { account_id: account.id, ...fields });
      await refresh();
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

  // Bulk Category assignment for the grid's multi-row selection. Reuses the
  // same `update_transaction` command as a single inline edit — each
  // selected Transaction keeps its own date/amount/description and only
  // gets a new category_id, so no new backend command is introduced.
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

  // Hidden transactions (#70): a right-click Hide/Unhide action on the
  // Transaction row calls the already-existing `set_transaction_hidden`
  // command, then refreshes -- same pattern as onUpdate/onDelete above.
  async function handleSetHidden(transaction: Transaction, hidden: boolean) {
    try {
      await invoke("set_transaction_hidden", { id: transaction.id, hidden });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Tag editing (#71): resolves a typed name to an existing Tag
  // (case-insensitive, matching how Tags are compared elsewhere -- see
  // `tags::get_or_create`) or creates one via `create_tag` (which is
  // itself create-if-not-exists), then attaches it -- immediate and
  // ungated, per #67's "Tags never route through" the create-new
  // confirmation dialog.
  async function resolveOrCreateTag(name: string): Promise<{ id: number }> {
    const existing = allTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    return invoke<Tag>("create_tag", { name });
  }

  async function handleAddTag(transactionId: number, tagName: string) {
    try {
      const tag = await resolveOrCreateTag(tagName);
      await invoke("attach_tag_to_transaction", { transaction_id: transactionId, tag_id: tag.id });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRemoveTag(transactionId: number, tagId: number) {
    try {
      await invoke("detach_tag_from_transaction", { transaction_id: transactionId, tag_id: tagId });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Bulk tag assignment (#71): same create-if-needed-then-attach path as a
  // single inline Tag add, applied to every selected Transaction.
  async function handleBulkAssignTags(ids: number[], tagNames: string[]) {
    try {
      for (const tagName of tagNames) {
        const tag = await resolveOrCreateTag(tagName);
        await Promise.all(
          ids.map((id) => invoke("attach_tag_to_transaction", { transaction_id: id, tag_id: tag.id })),
        );
      }
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Payee editing (#72, ADR-0019): a new, on-demand, single-Transaction
  // writer to `merchant_name`, via the new `set_transaction_merchant_name`
  // command -- deliberately not folded into `update_transaction` so this
  // edit never touches date/amount/description/category_id.
  async function handleSetPayee(transactionId: number, payeeName: string) {
    try {
      await invoke("set_transaction_merchant_name", { id: transactionId, merchant_name: payeeName });
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  // Confirmed "add to Merchant dictionary" path (ADR-0019): creates a
  // Merchant entry keyed on the transaction's full raw `description`
  // verbatim (not a derived/shortened substring) -> the typed Payee name,
  // for future imports only, then sets `merchant_name` on the edited
  // Transaction the same way a decline would. Never touches any other
  // Transaction, even one sharing the identical raw description -- the
  // dictionary write only affects *future* imports, per ADR-0012.
  async function handleCreateMerchant(transactionId: number, description: string, payeeName: string) {
    try {
      await invoke("create_merchant", { keyword: description, merchant_name: payeeName });
    } catch (err) {
      setError(String(err));
    }
    await handleSetPayee(transactionId, payeeName);
  }

  return (
    <section>
      <button type="button" className="back-link" onClick={onBack}>
        &larr; All accounts
      </button>

      <div className="content-header">
        <div>
          <h2 className="account-title">{account.name}</h2>
          <div className="account-title-meta">
            {ACCOUNT_TYPE_LABELS[account.account_type]}
            {account.institution_name ? ` · ${account.institution_name}` : ""}
          </div>
        </div>
        <div className="content-header-actions">
          <label className="show-hidden-toggle">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.currentTarget.checked)}
            />
            Show hidden
          </label>
          <button type="button" onClick={onImport}>
            Import
          </button>
          <button type="button" onClick={exportCsv} disabled={exportingCsv}>
            {exportingCsv ? "Exporting…" : "Export CSV…"}
          </button>
          <div className="balance">
            <span className="balance-label">Balance</span>
            {formatCents(balanceCents)}
          </div>
        </div>
      </div>

      {csvExportResult && <p className="csv-export-status">{csvExportResult}</p>}
      {csvExportError && (
        <p className="csv-export-status" role="alert">
          {csvExportError}
        </p>
      )}

      <div className="ledger-view-toggle">
        <button
          type="button"
          className={ledgerView === "transactions" ? "active" : ""}
          onClick={() => setLedgerView("transactions")}
        >
          Transactions
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      {ledgerView === "transactions" && (
        <div className="ledger-container">
          <TransactionsGrid
            transactions={transactions}
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
            tags={allTags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
            onBulkAssignTags={handleBulkAssignTags}
            merchants={allMerchants}
            onSetPayee={handleSetPayee}
            onCreateMerchant={handleCreateMerchant}
          />

          <div className="ledger new-transaction-row">
            <TransactionForm categories={categories} onSubmit={handleCreate} />
          </div>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account, ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { Category } from "../categories/types";
import { HoldingsScreen } from "../holdings/HoldingsScreen";
import { RecurringItemsScreen } from "../recurring/RecurringItemsScreen";
import { Tag } from "../tags/types";
import { Transfer } from "../transfers/types";
import { TransactionForm } from "./TransactionForm";
import { TransactionsGrid } from "./TransactionsGrid";
import { formatCents, Transaction, TransactionFields } from "./types";
import { useConfirmation } from "../ui/ConfirmationProvider";
import { useCsvExport } from "../ui/useCsvExport";

interface TransactionsScreenProps {
  account: Account;
  onBack: () => void;
  onImport: () => void;
}

type LedgerView = "holdings" | "transactions" | "recurring";

export function TransactionsScreen({ account, onBack, onImport }: TransactionsScreenProps) {
  const isInvestment = account.account_type === "investment";
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [tagsByTransactionId, setTagsByTransactionId] = useState<Record<number, Tag[]>>({});
  const [balanceCents, setBalanceCents] = useState(0);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerView, setLedgerView] = useState<LedgerView>(isInvestment ? "holdings" : "transactions");
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
      const [transactionList, balance, categoryList, accountList, transferList, tagsByTransaction] =
        await Promise.all([
          invoke<Transaction[]>("list_transactions", { account_id: account.id }),
          invoke<number>("account_balance_cents", { account_id: account.id }),
          invoke<Category[]>("list_categories"),
          invoke<Account[]>("list_accounts"),
          invoke<Transfer[]>("list_transfers"),
          invoke<Record<number, Tag[]>>("list_tags_for_account", { account_id: account.id }),
        ]);
      setTransactions(transactionList);
      setBalanceCents(balance);
      setCategories(categoryList);
      setAccounts(accountList);
      setTransfers(transferList);
      setTagsByTransactionId(tagsByTransaction);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    setLedgerView(isInvestment ? "holdings" : "transactions");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

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
        {isInvestment && (
          <button
            type="button"
            className={ledgerView === "holdings" ? "active" : ""}
            onClick={() => setLedgerView("holdings")}
          >
            Holdings
          </button>
        )}
        <button
          type="button"
          className={ledgerView === "transactions" ? "active" : ""}
          onClick={() => setLedgerView("transactions")}
        >
          Transactions
        </button>
        <button
          type="button"
          className={ledgerView === "recurring" ? "active" : ""}
          onClick={() => setLedgerView("recurring")}
        >
          Recurring
        </button>
      </div>

      {error && <p role="alert">{error}</p>}

      {ledgerView === "holdings" ? (
        <HoldingsScreen account={account} />
      ) : ledgerView === "recurring" ? (
        <RecurringItemsScreen account={account} categories={categories} />
      ) : (
        <div className="ledger-container">
          <TransactionsGrid
            transactions={transactions}
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

          <div className="ledger new-transaction-row">
            <TransactionForm categories={categories} onSubmit={handleCreate} />
          </div>
        </div>
      )}
    </section>
  );
}

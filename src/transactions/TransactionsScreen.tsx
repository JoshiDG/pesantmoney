import { Fragment, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account, ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { Category } from "../categories/types";
import { HoldingsScreen } from "../holdings/HoldingsScreen";
import { RecurringItemsScreen } from "../recurring/RecurringItemsScreen";
import { TransferPicker } from "../transfers/TransferPicker";
import { Transfer } from "../transfers/types";
import { TransactionForm } from "./TransactionForm";
import { formatCents, Transaction, TransactionFields } from "./types";

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
  const [balanceCents, setBalanceCents] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ledgerView, setLedgerView] = useState<LedgerView>(isInvestment ? "holdings" : "transactions");

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

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
      const [transactionList, balance, categoryList, accountList, transferList] = await Promise.all([
        invoke<Transaction[]>("list_transactions", { account_id: account.id }),
        invoke<number>("account_balance_cents", { account_id: account.id }),
        invoke<Category[]>("list_categories"),
        invoke<Account[]>("list_accounts"),
        invoke<Transfer[]>("list_transfers"),
      ]);
      setTransactions(transactionList);
      setBalanceCents(balance);
      setCategories(categoryList);
      setAccounts(accountList);
      setTransfers(transferList);
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
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(transaction: Transaction) {
    const confirmed = window.confirm(
      `Delete this transaction ("${transaction.description}")? This cannot be undone.`,
    );
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
          <div className="balance">
            <span className="balance-label">Balance</span>
            {formatCents(balanceCents)}
          </div>
        </div>
      </div>

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
        <div className="ledger">
          <div className="ledger-head">
            <span>Date</span>
            <span>Description</span>
            <span>Category</span>
            <span>Amount</span>
            <span></span>
          </div>

          {transactions.map((transaction) =>
            editingId === transaction.id ? (
              <TransactionForm
                key={transaction.id}
                categories={categories}
                initial={transaction}
                onSubmit={(fields) => handleUpdate(transaction.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <Fragment key={transaction.id}>
                <div className={`ledger-row${linkedTransactionIds.has(transaction.id) ? " is-transfer" : ""}`}>
                  <span>{transaction.date}</span>
                  <span className="cell-description">
                    {linkedTransactionIds.has(transaction.id) && (
                      <span className="transfer-badge" title="Part of a transfer">
                        ⇄
                      </span>
                    )}
                    {transaction.description}
                  </span>
                  <span className="cell-category">
                    {transaction.category_id != null
                      ? categoryNameById.get(transaction.category_id) ?? "Uncategorized"
                      : "Uncategorized"}
                  </span>
                  <span className={`amount ${transaction.amount_cents < 0 ? "debit" : "credit"}`}>
                    {formatCents(transaction.amount_cents)}
                  </span>
                  <span className="row-actions">
                    <button type="button" onClick={() => setEditingId(transaction.id)}>
                      Edit
                    </button>
                    {linkedTransactionIds.has(transaction.id) ? (
                      <button
                        type="button"
                        onClick={() => {
                          const transfer = transferByTransactionId.get(transaction.id);
                          if (transfer) {
                            handleUnlink(transfer);
                          }
                        }}
                      >
                        Unlink
                      </button>
                    ) : (
                      <button type="button" onClick={() => setLinkingId(transaction.id)}>
                        Link transfer
                      </button>
                    )}
                    <button type="button" onClick={() => handleDelete(transaction)}>
                      Delete
                    </button>
                  </span>
                </div>

                {linkingId === transaction.id && (
                  <div className="transfer-picker-row">
                    <TransferPicker
                      transaction={transaction}
                      accounts={accounts}
                      linkedTransactionIds={linkedTransactionIds}
                      onLink={(toTransactionId) => handleLink(transaction.id, toTransactionId)}
                      onCancel={() => setLinkingId(null)}
                    />
                  </div>
                )}
              </Fragment>
            ),
          )}

          <TransactionForm categories={categories} onSubmit={handleCreate} />
        </div>
      )}
    </section>
  );
}

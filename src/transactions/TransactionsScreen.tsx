import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account, ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { Category } from "../categories/types";
import { TransactionForm } from "./TransactionForm";
import { formatCents, Transaction, TransactionFields } from "./types";

interface TransactionsScreenProps {
  account: Account;
  onBack: () => void;
}

export function TransactionsScreen({ account, onBack }: TransactionsScreenProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [balanceCents, setBalanceCents] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  async function refresh() {
    try {
      const [transactionList, balance, categoryList] = await Promise.all([
        invoke<Transaction[]>("list_transactions", { account_id: account.id }),
        invoke<number>("account_balance_cents", { account_id: account.id }),
        invoke<Category[]>("list_categories"),
      ]);
      setTransactions(transactionList);
      setBalanceCents(balance);
      setCategories(categoryList);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
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
        <div className="balance">
          <span className="balance-label">Balance</span>
          {formatCents(balanceCents)}
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

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
            <div className="ledger-row" key={transaction.id}>
              <span>{transaction.date}</span>
              <span className="cell-description">{transaction.description}</span>
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
                <button type="button" onClick={() => handleDelete(transaction)}>
                  Delete
                </button>
              </span>
            </div>
          ),
        )}

        <TransactionForm categories={categories} onSubmit={handleCreate} />
      </div>
    </section>
  );
}

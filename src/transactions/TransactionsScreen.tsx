import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { TransactionForm } from "./TransactionForm";
import { formatCents, Transaction, TransactionFields } from "./types";

interface TransactionsScreenProps {
  account: Account;
  onBack: () => void;
}

export function TransactionsScreen({ account, onBack }: TransactionsScreenProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balanceCents, setBalanceCents] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [transactionList, balance] = await Promise.all([
        invoke<Transaction[]>("list_transactions", { accountId: account.id }),
        invoke<number>("account_balance_cents", { accountId: account.id }),
      ]);
      setTransactions(transactionList);
      setBalanceCents(balance);
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
      await invoke("create_transaction", { accountId: account.id, ...fields });
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
      `Delete this Transaction ("${transaction.description}")? This cannot be undone.`,
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
      <button type="button" onClick={onBack}>
        &larr; Back to Accounts
      </button>
      <h2>{account.name}</h2>
      <p>Balance: {formatCents(balanceCents)}</p>
      {error && <p role="alert">{error}</p>}

      <TransactionForm onSubmit={handleCreate} />

      <ul>
        {transactions.map((transaction) =>
          editingId === transaction.id ? (
            <li key={transaction.id}>
              <TransactionForm
                initial={transaction}
                onSubmit={(fields) => handleUpdate(transaction.id, fields)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={transaction.id}>
              <span>
                {transaction.date} — {transaction.description} —{" "}
                {formatCents(transaction.amount_cents)}
              </span>
              <button type="button" onClick={() => setEditingId(transaction.id)}>
                Edit
              </button>
              <button type="button" onClick={() => handleDelete(transaction)}>
                Delete
              </button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

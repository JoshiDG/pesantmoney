import { FormEvent, useState } from "react";
import { centsToDollarInput, dollarInputToCents, Transaction, TransactionFields } from "./types";

interface TransactionFormProps {
  initial?: Transaction;
  onSubmit: (fields: TransactionFields) => void;
  onCancel?: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TransactionForm({ initial, onSubmit, onCancel }: TransactionFormProps) {
  const [date, setDate] = useState(initial?.date ?? today());
  const [amount, setAmount] = useState(
    initial ? centsToDollarInput(initial.amount_cents) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      date,
      amount_cents: dollarInputToCents(amount),
      description,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="transaction-form">
      <input
        aria-label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Amount"
        type="number"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Description"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        required
      />
      <button type="submit">{initial ? "Save" : "Add Transaction"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

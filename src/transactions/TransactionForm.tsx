import { FormEvent, useState } from "react";
import { Category } from "../categories/types";
import { centsToDollarInput, dollarInputToCents, Transaction, TransactionFields } from "./types";

interface TransactionFormProps {
  categories: Category[];
  initial?: Transaction;
  onSubmit: (fields: TransactionFields) => void;
  onCancel?: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const UNCATEGORIZED = "";

export function TransactionForm({ categories, initial, onSubmit, onCancel }: TransactionFormProps) {
  const [date, setDate] = useState(initial?.date ?? today());
  const [amount, setAmount] = useState(
    initial ? centsToDollarInput(initial.amount_cents) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(
    initial?.category_id != null ? String(initial.category_id) : UNCATEGORIZED,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      date,
      amount_cents: dollarInputToCents(amount),
      description,
      category_id: categoryId === UNCATEGORIZED ? null : Number(categoryId),
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
        aria-label="Description"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        required
      />
      <select
        aria-label="Category"
        value={categoryId}
        onChange={(e) => setCategoryId(e.currentTarget.value)}
      >
        <option value={UNCATEGORIZED}>Uncategorized</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <input
        aria-label="Amount"
        type="number"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        required
      />
      <div className="txn-form-actions">
        <button type="submit">{initial ? "Save" : "Add"}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

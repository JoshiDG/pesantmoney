import { FormEvent, useState } from "react";
import { Category } from "../categories/types";
import { centsToDollarInput, dollarInputToCents } from "../transactions/types";
import { FREQUENCIES, FREQUENCY_LABELS, RecurringItem, RecurringItemFields } from "./types";

interface RecurringItemFormProps {
  categories: Category[];
  initial?: RecurringItem;
  onSubmit: (fields: RecurringItemFields) => void;
  onCancel?: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const UNCATEGORIZED = "";

export function RecurringItemForm({ categories, initial, onSubmit, onCancel }: RecurringItemFormProps) {
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(initial ? centsToDollarInput(initial.amount_cents) : "");
  const [frequency, setFrequency] = useState(initial?.frequency ?? "monthly");
  const [nextExpectedDate, setNextExpectedDate] = useState(initial?.next_expected_date ?? today());
  const [categoryId, setCategoryId] = useState(
    initial?.category_id != null ? String(initial.category_id) : UNCATEGORIZED,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      description,
      amount_cents: dollarInputToCents(amount),
      frequency: frequency as RecurringItemFields["frequency"],
      next_expected_date: nextExpectedDate,
      category_id: categoryId === UNCATEGORIZED ? null : Number(categoryId),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="recurring-item-form">
      <input
        aria-label="Description"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
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
      <select
        aria-label="Frequency"
        value={frequency}
        onChange={(e) => setFrequency(e.currentTarget.value as RecurringItemFields["frequency"])}
      >
        {FREQUENCIES.map((f) => (
          <option key={f} value={f}>
            {FREQUENCY_LABELS[f]}
          </option>
        ))}
      </select>
      <input
        aria-label="Next expected date"
        type="date"
        value={nextExpectedDate}
        onChange={(e) => setNextExpectedDate(e.currentTarget.value)}
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

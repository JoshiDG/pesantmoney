import { FormEvent, useState } from "react";
import { centsToDollarInput, dollarInputToCents, Holding, HoldingFields } from "./types";

interface HoldingFormProps {
  initial?: Holding;
  onSubmit: (fields: HoldingFields) => void;
  onCancel?: () => void;
}

export function HoldingForm({ initial, onSubmit, onCancel }: HoldingFormProps) {
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "");
  const [costBasis, setCostBasis] = useState(
    initial?.cost_basis_cents != null ? centsToDollarInput(initial.cost_basis_cents) : "",
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      ticker: ticker.trim().toUpperCase(),
      quantity: parseFloat(quantity),
      cost_basis_cents: costBasis.trim() === "" ? null : dollarInputToCents(costBasis),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="holding-form">
      <input
        aria-label="Ticker"
        placeholder="Ticker"
        value={ticker}
        onChange={(e) => setTicker(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Quantity"
        type="number"
        step="any"
        placeholder="Quantity"
        value={quantity}
        onChange={(e) => setQuantity(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Cost basis"
        type="number"
        step="0.01"
        placeholder="Cost basis (optional)"
        value={costBasis}
        onChange={(e) => setCostBasis(e.currentTarget.value)}
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

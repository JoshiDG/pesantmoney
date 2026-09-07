import { FormEvent, useState } from "react";
import { dollarInputToCents } from "./types";

interface PriceFormProps {
  ticker: string;
  onSubmit: (priceCents: number, asOfDate: string) => void;
  onCancel: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PriceForm({ ticker, onSubmit, onCancel }: PriceFormProps) {
  const [price, setPrice] = useState("");
  const [asOfDate, setAsOfDate] = useState(today());

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(dollarInputToCents(price), asOfDate);
  }

  return (
    <form onSubmit={handleSubmit} className="price-form">
      <span className="price-form-ticker">{ticker}</span>
      <input
        aria-label={`Price for ${ticker}`}
        type="number"
        step="0.01"
        placeholder="Price"
        value={price}
        onChange={(e) => setPrice(e.currentTarget.value)}
        required
      />
      <input
        aria-label={`As of date for ${ticker}`}
        type="date"
        value={asOfDate}
        onChange={(e) => setAsOfDate(e.currentTarget.value)}
        required
      />
      <div className="txn-form-actions">
        <button type="submit">Update price</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

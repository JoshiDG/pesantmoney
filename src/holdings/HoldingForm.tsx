import { FormEvent, useState } from "react";
import { Account } from "../accounts/types";
import { centsToDollarInput, dollarInputToCents, Holding, HoldingFields } from "./types";

interface HoldingFormProps {
  initial?: Holding;
  // When provided (the all-Accounts Investments screen's create form, since
  // it has no single Account already in context), renders an Account picker
  // and passes the chosen id as `onSubmit`'s second argument. Omitted by the
  // per-Account Holdings screen, which already knows its Account.
  accounts?: Account[];
  onSubmit: (fields: HoldingFields, accountId?: number) => void;
  onCancel?: () => void;
}

export function HoldingForm({ initial, accounts, onSubmit, onCancel }: HoldingFormProps) {
  const [ticker, setTicker] = useState(initial?.ticker ?? "");
  const [quantity, setQuantity] = useState(initial ? String(initial.quantity) : "");
  const [costBasis, setCostBasis] = useState(
    initial?.cost_basis_cents != null ? centsToDollarInput(initial.cost_basis_cents) : "",
  );
  const [accountId, setAccountId] = useState(accounts && accounts.length > 0 ? String(accounts[0].id) : "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(
      {
        ticker: ticker.trim().toUpperCase(),
        quantity: parseFloat(quantity),
        cost_basis_cents: costBasis.trim() === "" ? null : dollarInputToCents(costBasis),
      },
      accounts ? Number(accountId) : undefined,
    );
  }

  return (
    <form onSubmit={handleSubmit} className="holding-form">
      {accounts && (
        <select
          aria-label="Account"
          value={accountId}
          onChange={(e) => setAccountId(e.currentTarget.value)}
          required
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      )}
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

import { FormEvent, useState } from "react";
import { Account } from "../accounts/types";
import { centsToDollarInput, dollarInputToCents, Holding, HoldingFields } from "./types";
import { CustomSelect } from "../ui/Dropdown";

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
        <CustomSelect
          ariaLabel="Account"
          options={accounts.map((account) => ({ value: String(account.id), label: account.name }))}
          value={accountId}
          onChange={setAccountId}
        />
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

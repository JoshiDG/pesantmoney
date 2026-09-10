import { FormEvent, useState } from "react";
import { Merchant, MerchantFields } from "./types";

interface MerchantFormProps {
  initial?: Merchant;
  onSubmit: (fields: MerchantFields) => void;
  onCancel?: () => void;
}

export function MerchantForm({ initial, onSubmit, onCancel }: MerchantFormProps) {
  const [keyword, setKeyword] = useState(initial?.keyword ?? "");
  const [merchantName, setMerchantName] = useState(initial?.merchant_name ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ keyword, merchant_name: merchantName });
  }

  return (
    <form onSubmit={handleSubmit} className="merchant-form">
      <input
        aria-label="Keyword"
        placeholder="Keyword to match (e.g. blue bottle)"
        value={keyword}
        onChange={(e) => setKeyword(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Merchant name"
        placeholder="Clean merchant name (e.g. Blue Bottle Coffee)"
        value={merchantName}
        onChange={(e) => setMerchantName(e.currentTarget.value)}
        required
      />
      <button type="submit">{initial ? "Save" : "Add merchant"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

import { FormEvent, useState } from "react";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, Account, AccountFields, AccountType } from "./types";

interface AccountFormProps {
  initial?: Account;
  onSubmit: (fields: AccountFields) => void;
  onCancel?: () => void;
}

export function AccountForm({ initial, onSubmit, onCancel }: AccountFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [accountType, setAccountType] = useState<AccountType>(
    initial?.account_type ?? "checking",
  );
  const [institutionName, setInstitutionName] = useState(initial?.institution_name ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      account_type: accountType,
      institution_name: institutionName.trim() === "" ? null : institutionName,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="account-form">
      <input
        aria-label="Account name"
        placeholder="Account name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        required
      />
      <select
        aria-label="Account type"
        value={accountType}
        onChange={(e) => setAccountType(e.currentTarget.value as AccountType)}
      >
        {ACCOUNT_TYPES.map((type) => (
          <option key={type} value={type}>
            {ACCOUNT_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <input
        aria-label="Institution"
        placeholder="Institution (optional)"
        value={institutionName}
        onChange={(e) => setInstitutionName(e.currentTarget.value)}
      />
      <button type="submit">{initial ? "Save" : "Add Account"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

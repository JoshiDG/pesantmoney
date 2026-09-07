import { FormEvent, useState } from "react";
import { Account } from "../accounts/types";
import { Category } from "../categories/types";
import { centsToDollarInput, dollarInputToCents } from "../transactions/types";
import {
  MATCH_TYPE_LABELS,
  MatchType,
  Rule,
  RULE_FIELD_LABELS,
  RuleField,
  RuleFields,
} from "./types";

interface RuleFormProps {
  accounts: Account[];
  categories: Category[];
  initial?: Rule;
  onSubmit: (fields: RuleFields) => void;
  onCancel?: () => void;
}

const RULE_FIELDS = Object.keys(RULE_FIELD_LABELS) as RuleField[];
const MATCH_TYPES = Object.keys(MATCH_TYPE_LABELS) as MatchType[];

export function RuleForm({ accounts, categories, initial, onSubmit, onCancel }: RuleFormProps) {
  const [field, setField] = useState<RuleField>(initial?.field ?? "description");
  const [matchType, setMatchType] = useState<MatchType>(initial?.match_type ?? "contains");
  const [descriptionValue, setDescriptionValue] = useState(
    initial && initial.field === "description" ? initial.match_value : "",
  );
  const [amountValue, setAmountValue] = useState(
    initial && initial.field === "amount" ? centsToDollarInput(Number(initial.match_value)) : "",
  );
  const [accountValue, setAccountValue] = useState(
    initial && initial.field === "account" ? initial.match_value : String(accounts[0]?.id ?? ""),
  );
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? categories[0]?.id ?? 0);
  const [priority, setPriority] = useState(initial?.priority ?? 0);

  function matchValueFor(currentField: RuleField): string {
    switch (currentField) {
      case "description":
        return descriptionValue;
      case "amount":
        return String(dollarInputToCents(amountValue || "0"));
      case "account":
        return accountValue;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      field,
      // Account and Amount rules only ever compare for equality; the match
      // type selector is only meaningful (and shown) for Description.
      match_type: field === "description" ? matchType : "equals",
      match_value: matchValueFor(field),
      category_id: categoryId,
      priority,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="rule-form">
      <select
        aria-label="Field"
        value={field}
        onChange={(e) => setField(e.currentTarget.value as RuleField)}
      >
        {RULE_FIELDS.map((f) => (
          <option key={f} value={f}>
            {RULE_FIELD_LABELS[f]}
          </option>
        ))}
      </select>

      {field === "description" && (
        <select
          aria-label="Match type"
          value={matchType}
          onChange={(e) => setMatchType(e.currentTarget.value as MatchType)}
        >
          {MATCH_TYPES.map((mt) => (
            <option key={mt} value={mt}>
              {MATCH_TYPE_LABELS[mt]}
            </option>
          ))}
        </select>
      )}

      {field === "description" && (
        <input
          aria-label="Match value"
          placeholder="Text to match"
          value={descriptionValue}
          onChange={(e) => setDescriptionValue(e.currentTarget.value)}
          required
        />
      )}

      {field === "amount" && (
        <input
          aria-label="Match value"
          type="number"
          step="0.01"
          placeholder="Amount"
          value={amountValue}
          onChange={(e) => setAmountValue(e.currentTarget.value)}
          required
        />
      )}

      {field === "account" && (
        <select
          aria-label="Match value"
          value={accountValue}
          onChange={(e) => setAccountValue(e.currentTarget.value)}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      )}

      <select
        aria-label="Category"
        value={categoryId}
        onChange={(e) => setCategoryId(Number(e.currentTarget.value))}
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>

      <input
        aria-label="Priority"
        type="number"
        step="1"
        title="Lower numbers run first"
        value={priority}
        onChange={(e) => setPriority(Number(e.currentTarget.value))}
      />

      <button type="submit">{initial ? "Save" : "Add rule"}</button>
      {onCancel && (
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </form>
  );
}

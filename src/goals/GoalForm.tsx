import { FormEvent, useState } from "react";
import { Account, ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { Category } from "../categories/types";
import { centsToDollarInput, dollarInputToCents } from "../transactions/types";
import { Goal, GoalFields } from "./types";

type LinkType = "category" | "account";

interface GoalFormProps {
  categories: Category[];
  // Accounts a Goal can link to as a debt paydown target. The caller
  // filters this to the debt-shaped account types (credit_card, loan) --
  // this component just renders whatever it's given.
  debtAccounts: Account[];
  initial?: Goal;
  onSubmit: (fields: GoalFields) => void;
  onCancel?: () => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function GoalForm({ categories, debtAccounts, initial, onSubmit, onCancel }: GoalFormProps) {
  // Which category/account a Goal links to is fixed for its lifetime (see
  // GoalsScreen / the backend's `update`, which never touches these
  // fields) -- so on edit the toggle and pickers are shown but disabled,
  // purely to remind the user which link the goal has rather than to let
  // them change it.
  const isEditing = Boolean(initial);
  const [linkType, setLinkType] = useState<LinkType>(
    initial?.linked_account_id != null ? "account" : "category",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [targetAmount, setTargetAmount] = useState(
    initial ? centsToDollarInput(initial.target_cents) : "",
  );
  const [targetDate, setTargetDate] = useState(initial?.target_date ?? today());
  const [categoryId, setCategoryId] = useState(
    initial?.linked_category_id ?? categories[0]?.id ?? 0,
  );
  const [accountId, setAccountId] = useState(
    initial?.linked_account_id ?? debtAccounts[0]?.id ?? 0,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      target_cents: dollarInputToCents(targetAmount),
      target_date: targetDate,
      linked_category_id: linkType === "category" ? categoryId : null,
      linked_account_id: linkType === "account" ? accountId : null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="goal-form">
      <input
        aria-label="Goal name"
        placeholder="Goal name"
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Target amount"
        type="number"
        step="0.01"
        placeholder="Target amount"
        value={targetAmount}
        onChange={(e) => setTargetAmount(e.currentTarget.value)}
        required
      />
      <input
        aria-label="Target date"
        type="date"
        value={targetDate}
        onChange={(e) => setTargetDate(e.currentTarget.value)}
        required
      />

      <div className="goal-form-link-type" role="radiogroup" aria-label="Goal type">
        <label>
          <input
            type="radio"
            name="goal-link-type"
            checked={linkType === "category"}
            disabled={isEditing}
            onChange={() => setLinkType("category")}
          />
          Savings category
        </label>
        <label>
          <input
            type="radio"
            name="goal-link-type"
            checked={linkType === "account"}
            disabled={isEditing}
            onChange={() => setLinkType("account")}
          />
          Debt account
        </label>
      </div>

      {linkType === "category" ? (
        <select
          aria-label="Savings category"
          value={categoryId}
          disabled={isEditing}
          onChange={(e) => setCategoryId(Number(e.currentTarget.value))}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      ) : (
        <select
          aria-label="Debt account"
          value={accountId}
          disabled={isEditing}
          onChange={(e) => setAccountId(Number(e.currentTarget.value))}
        >
          {debtAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({ACCOUNT_TYPE_LABELS[account.account_type]})
            </option>
          ))}
        </select>
      )}

      <div className="goal-form-actions">
        <button type="submit">{initial ? "Save" : "Add goal"}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

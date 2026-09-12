import { Account } from "../../accounts/types";
import { CustomSelect } from "../../ui/Dropdown";

// The Bloomberg command-line-style bar below the Function Bar (see
// CONTEXT.md's "Context Bar" glossary entry): carries *where* the grid is
// looking, not actions. Phase 1 (#90) holds only the Account context
// selector -- the live search input is added in #92, once the filter model
// it composes with exists (#91).
export interface ContextBarProps {
  accounts: Account[];
  accountFilter: number | null;
  onAccountFilterChange: (accountId: number | null) => void;
}

export function ContextBar({ accounts, accountFilter, onAccountFilterChange }: ContextBarProps) {
  return (
    <div className="context-bar">
      <label className="context-bar-field">
        <span className="context-bar-label">Account</span>
        <CustomSelect
          ariaLabel="Filter by account"
          options={[
            { value: "all", label: "All accounts" },
            ...accounts.map((account) => ({ value: String(account.id), label: account.name })),
          ]}
          value={accountFilter == null ? "all" : String(accountFilter)}
          onChange={(val) => onAccountFilterChange(val === "all" ? null : Number(val))}
        />
      </label>
    </div>
  );
}

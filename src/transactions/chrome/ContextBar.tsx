import { Ref } from "react";
import { Account } from "../../accounts/types";
import { CustomSelect } from "../../ui/Dropdown";

// The Bloomberg command-line-style bar below the Function Bar (see
// CONTEXT.md's "Context Bar" glossary entry): carries *where* the grid is
// looking, not actions. Phase 1 (#90) held only the Account context
// selector; #92 adds the live search input, focused by the already-reserved
// Cmd+F (wired at the screen level via `searchInputRef`) and by `/` from the
// grid. Escape, handled locally here, clears and blurs it -- the screen's
// CANC chip and Reserved Shortcut Set Escape handler clear the underlying
// `searchTerm` state the same way, independent of whether this input has
// DOM focus at the time.
export interface ContextBarProps {
  accounts: Account[];
  accountFilter: number | null;
  onAccountFilterChange: (accountId: number | null) => void;
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
  searchInputRef?: Ref<HTMLInputElement>;
}

export function ContextBar({
  accounts,
  accountFilter,
  onAccountFilterChange,
  searchTerm,
  onSearchTermChange,
  searchInputRef,
}: ContextBarProps) {
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
      <label className="context-bar-field context-bar-search">
        <span className="context-bar-label">Search</span>
        <input
          ref={searchInputRef}
          type="text"
          className="context-bar-search-input"
          aria-label="Search transactions"
          placeholder="Payee, memo, category, tags…"
          value={searchTerm}
          onChange={(e) => onSearchTermChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onSearchTermChange("");
              e.currentTarget.blur();
            }
          }}
        />
      </label>
    </div>
  );
}

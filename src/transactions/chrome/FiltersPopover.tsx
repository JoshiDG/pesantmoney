import { useEffect, useRef } from "react";
import { TRANSACTION_TYPE_FACETS, TransactionTypeFacet } from "../filters";

// The Function Bar's Filters chip popover (#91, ADR-0021): cross-cutting
// facets that aren't tied to a single column -- Type (income/expense/
// transfer) and Show Hidden -- plus Clear All, which resets every filter
// (this popover's facets *and* every column's own right-click filter,
// see AllTransactionsScreen's `handleClearAllFilters`). Per-column value
// filters live in their own right-click menu on the grid's header instead
// (ColumnFilterMenu items built in AllTransactionsScreen), reusing the
// shared ContextMenu component rather than this popover.
export interface FiltersPopoverProps {
  x: number;
  y: number;
  types: Set<TransactionTypeFacet>;
  showHidden: boolean;
  onToggleType: (type: TransactionTypeFacet) => void;
  onToggleShowHidden: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<TransactionTypeFacet, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

export function FiltersPopover({
  x,
  y,
  types,
  showHidden,
  onToggleType,
  onToggleShowHidden,
  onClearAll,
  onClose,
}: FiltersPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="filters-popover"
      style={{ top: `${y}px`, left: `${x}px` }}
      role="dialog"
      aria-label="Filters"
    >
      <div className="filters-popover-section">
        <span className="filters-popover-heading">Type</span>
        {TRANSACTION_TYPE_FACETS.map((type) => (
          <label key={type} className="filters-popover-checkbox">
            <input type="checkbox" checked={types.has(type)} onChange={() => onToggleType(type)} />
            {TYPE_LABELS[type]}
          </label>
        ))}
      </div>
      <div className="filters-popover-section">
        <label className="filters-popover-checkbox">
          <input type="checkbox" checked={showHidden} onChange={onToggleShowHidden} />
          Show Hidden
        </label>
      </div>
      <button type="button" className="filters-popover-clear" onClick={onClearAll}>
        Clear All
      </button>
    </div>
  );
}

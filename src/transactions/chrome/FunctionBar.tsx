import { Ref } from "react";

// The Bloomberg-style row of color-coded action chips at the top of the
// Transactions screen (see CONTEXT.md's "Function Bar" glossary entry).
// Screen-level actions only -- row-level actions (Hide/Unhide, Link/Unlink,
// Delete) stay on TransactionsGrid's row context menu (ADR-0021).
//
// Each chip's color is a Function Bar *role*, not a one-off style choice:
// CANC is the Bloomberg keyboard's red Cancel-key role, New is the green
// Go/action role, Import/Export/Columns share the yellow primary role, and
// Filters/Show Hidden share the magenta secondary role. All four roles
// resolve through the Palette (`src/ui/palette.css`, ADR-0021) so retuning
// the scheme later never touches this component.
export interface FunctionBarProps {
  // CANC (#90): resets search/filters. Search and the per-column filter
  // model land in #91/#92 -- until then this only resets the one filter
  // already wired here (Show Hidden), which keeps it a real, safe action
  // rather than a dead button.
  onCancel: () => void;
  onNew: () => void;
  newDisabled?: boolean;
  onImport: () => void;
  importDisabled?: boolean;
  onExport: () => void;
  exportLabel: string;
  exportDisabled?: boolean;
  onColumns: () => void;
  columnsButtonRef?: Ref<HTMLButtonElement>;
  // Filters (#91): opens the Filters popover (Type, Show Hidden, Clear
  // All -- see FiltersPopover). `filtersButtonRef` anchors the popover the
  // same way `columnsButtonRef` anchors the Columns checklist above.
  // `filtersActive` shows a badge (active facet count) while any filter --
  // a column filter, Type, Show Hidden, or a non-"all" Date preset -- is
  // set, so the chip stays informative even while its own popover is
  // closed.
  onFilters: () => void;
  filtersButtonRef?: Ref<HTMLButtonElement>;
  filtersActive?: boolean;
  filtersActiveCount?: number;
  showHidden: boolean;
  onToggleShowHidden: () => void;
}

export function FunctionBar({
  onCancel,
  onNew,
  newDisabled,
  onImport,
  importDisabled,
  onExport,
  exportLabel,
  exportDisabled,
  onColumns,
  columnsButtonRef,
  onFilters,
  filtersButtonRef,
  filtersActive,
  filtersActiveCount,
  showHidden,
  onToggleShowHidden,
}: FunctionBarProps) {
  return (
    <div className="function-bar" role="toolbar" aria-label="Transactions actions">
      <button
        type="button"
        className="function-bar-chip function-bar-chip--cancel"
        onClick={onCancel}
      >
        CANC
      </button>
      <button
        type="button"
        className="function-bar-chip function-bar-chip--action"
        onClick={onNew}
        disabled={newDisabled}
        aria-label="New Transaction"
      >
        New
      </button>
      <button
        type="button"
        className="function-bar-chip function-bar-chip--primary"
        onClick={onImport}
        disabled={importDisabled}
      >
        Import
      </button>
      <button
        type="button"
        className="function-bar-chip function-bar-chip--primary"
        onClick={onExport}
        disabled={exportDisabled}
      >
        {exportLabel}
      </button>
      <button
        type="button"
        ref={columnsButtonRef}
        className="function-bar-chip function-bar-chip--primary"
        onClick={onColumns}
      >
        Columns
      </button>
      <button
        type="button"
        ref={filtersButtonRef}
        className={`function-bar-chip function-bar-chip--secondary ${filtersActive ? "function-bar-chip--active" : ""}`}
        onClick={onFilters}
        aria-pressed={filtersActive}
      >
        Filters
        {filtersActive && (
          <span className="function-bar-chip-badge" aria-label={`${filtersActiveCount} active filters`}>
            {filtersActiveCount}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`function-bar-chip function-bar-chip--secondary ${showHidden ? "function-bar-chip--active" : ""}`}
        onClick={onToggleShowHidden}
        aria-pressed={showHidden}
        aria-label="Show hidden"
      >
        Show Hidden
      </button>
    </div>
  );
}

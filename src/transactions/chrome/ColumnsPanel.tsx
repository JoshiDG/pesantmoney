import { useEffect, useRef } from "react";
import { COLUMN_LABELS, ColumnKey } from "../grid-nav";
import { ColumnVisibility } from "../types";

// The Function Bar's Columns chip popover (#90, reordering added in #94/
// ADR-0021 phase 5): a dedicated panel rather than the generic ContextMenu
// (see src/ui/ContextMenu.tsx) since each row now needs three independent
// controls -- a visibility checkbox plus Move Up/Move Down -- and
// ContextMenu's items are each a single whole-row button, which can't host
// nested interactive controls. Reflects the *same* `columnOrder`/
// `columnVisibility` state TransactionsGrid's header drag-reorder drives, so
// dragging a header and using this panel's arrows are two views onto one
// source of truth (AllTransactionsScreen owns both).
export interface ColumnsPanelProps {
  x: number;
  y: number;
  columns: ColumnKey[];
  visibility: ColumnVisibility;
  onToggleVisibility: (column: ColumnKey) => void;
  onMove: (column: ColumnKey, direction: "up" | "down") => void;
  onClose: () => void;
}

export function ColumnsPanel({ x, y, columns, visibility, onToggleVisibility, onMove, onClose }: ColumnsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
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

  const panelWidth = 240;
  const panelHeight = columns.length * 36 + 12;
  const adjustedX = Math.max(8, Math.min(x, window.innerWidth - panelWidth - 8));
  const adjustedY = Math.max(8, Math.min(y, window.innerHeight - panelHeight - 8));

  return (
    <div
      ref={panelRef}
      className="context-menu columns-panel"
      style={{ top: `${adjustedY}px`, left: `${adjustedX}px` }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
      aria-label="Column Management"
    >
      {columns.map((column, index) => (
        <div className="columns-panel-row" key={column}>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={visibility[column]}
            className="context-menu-item columns-panel-toggle"
            onClick={() => onToggleVisibility(column)}
          >
            <span className="context-menu-checkbox" aria-hidden="true">
              {visibility[column] ? "✓" : ""}
            </span>
            <span>{COLUMN_LABELS[column]}</span>
          </button>
          <div className="columns-panel-move">
            <button
              type="button"
              className="columns-panel-move-btn"
              aria-label={`Move ${COLUMN_LABELS[column]} up`}
              disabled={index === 0}
              onClick={() => onMove(column, "up")}
            >
              ▲
            </button>
            <button
              type="button"
              className="columns-panel-move-btn"
              aria-label={`Move ${COLUMN_LABELS[column]} down`}
              disabled={index === columns.length - 1}
              onClick={() => onMove(column, "down")}
            >
              ▼
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

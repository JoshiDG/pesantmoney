import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { isTextInputTarget, nextCellForKey } from "../ui/grid-nav";
import { selectRowRange, toggleRowSelection } from "../ui/selection";

// Row-level keyboard navigation + multi-select for one Recurring Items
// section (Detected or Confirmed -- see RecurringItemsScreen/
// AllRecurringScreen). Adopts the shared grid-nav/selection primitives
// (#76, ADR-0020's "Grid keyboard navigation") the same way TransactionsGrid
// does, but scoped to a single column of whole-row focus rather than
// per-cell inline editing: Recurring rows don't support cell-level editing
// (Edit opens a full RecurringItemForm instead), so every row is treated as
// column 0 of a colCount-1 grid -- `nextCellForKey` only ever moves the row
// index up/down for this screen.
//
// Detected and Confirmed are separate sections with different available
// actions (Confirm/Dismiss vs. Edit/Delete), so each gets its own nav/
// selection instance -- selection and keyboard focus never span both.
export interface RecurringSectionNav {
  focusedRow: number | null;
  isFocused: (index: number) => boolean;
  isSelected: (id: number) => boolean;
  selectedCount: number;
  selectedIds: number[];
  rowRef: (index: number) => (el: HTMLDivElement | null) => void;
  handleRowFocus: (index: number) => void;
  // `shortcuts` maps a bare key (e.g. "c", "d", "e") to the action it
  // triggers for the row under keyboard focus -- the scoped single-letter
  // shortcuts ADR-0020 calls for, active only while a row in this section
  // has focus and never firing while a text input has focus (guarded via
  // `isTextInputTarget`, same as grid-nav.ts documents).
  handleRowKeyDown: (
    e: KeyboardEvent<HTMLDivElement>,
    index: number,
    shortcuts?: Record<string, () => void>,
  ) => void;
  toggleSelectRow: (id: number, shiftKey: boolean) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
}

export function useRecurringSectionNav(orderedIds: number[]): RecurringSectionNav {
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (focusedRow != null) {
      const el = rowRefs.current[focusedRow];
      // Guard against re-focusing an already-focused element -- same
      // rationale as TransactionsGrid's identical effect: some DOM
      // implementations (jsdom included) re-dispatch a focus event even
      // when the target is already the activeElement.
      if (el && document.activeElement !== el) {
        el.focus();
      }
    }
  }, [focusedRow]);

  // Keep focus/selection consistent when the underlying list shrinks (e.g.
  // a Confirm/Delete triggers a refetch that removes rows from this
  // section) -- stale ids in `selected` or an out-of-range `focusedRow`
  // would otherwise linger.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => orderedIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
    setFocusedRow((prev) => (prev != null && prev >= orderedIds.length ? null : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedIds.length]);

  function handleRowFocus(index: number) {
    setFocusedRow(index);
  }

  function handleRowKeyDown(
    e: KeyboardEvent<HTMLDivElement>,
    index: number,
    shortcuts: Record<string, () => void> = {},
  ) {
    if (isTextInputTarget(e.target)) return;

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = nextCellForKey({ row: index, col: 0 }, e.key, orderedIds.length, 1);
      setFocusedRow(next.row);
      return;
    }

    const action = shortcuts[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  }

  function toggleSelectRow(id: number, shiftKey: boolean) {
    if (shiftKey && anchorId != null) {
      setSelected(selectRowRange(orderedIds, anchorId, id));
      return;
    }
    setSelected((prev) => toggleRowSelection(prev, id));
    setAnchorId(id);
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === orderedIds.length ? new Set() : new Set(orderedIds)));
  }

  function clearSelection() {
    setSelected(new Set());
    setAnchorId(null);
  }

  return {
    focusedRow,
    isFocused: (index) => focusedRow === index,
    isSelected: (id) => selected.has(id),
    selectedCount: selected.size,
    selectedIds: Array.from(selected),
    rowRef: (index) => (el) => {
      rowRefs.current[index] = el;
    },
    handleRowFocus,
    handleRowKeyDown,
    toggleSelectRow,
    toggleSelectAll,
    clearSelection,
  };
}

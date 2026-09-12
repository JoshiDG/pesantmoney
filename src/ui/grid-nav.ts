// Pure keyboard-navigation logic for any inline-editable, cell-grid-shaped
// view (row x column, arrow keys + Tab/Shift+Tab + Enter/Shift+Enter). Kept
// free of React/DOM so it can be unit tested directly and reused by any
// screen with a grid-shaped keyboard-navigable layout (see ADR-0020's
// "Grid keyboard navigation" section) -- e.g. TransactionsGrid, BudgetScreen,
// and future Accounts/Recurring/Goals/Holdings/Categories/Rules grids.
//
// This module is intentionally domain-agnostic: it knows nothing about what
// a "column" represents for any particular screen. Screens define their own
// column set/keys and pass `colCount`/`rowCount` in.

export interface CellPos {
  row: number;
  col: number;
}

// How many rows PageUp/PageDown jump by -- a screenful-ish stride rather
// than a literal page measurement, since the nav math is DOM-free.
const PAGE_STRIDE = 10;

/**
 * Given a focused cell and a key event's `key` (plus the Shift/Ctrl
 * modifiers), returns the cell that should become focused next. Movement
 * is clamped to the grid's bounds rather than wrapping past the
 * first/last row, so repeated presses at an edge are no-ops. Tab/Shift+Tab
 * wrap within a row (last column -> first column of next row, and back).
 * Home/End jump to the first/last column of the current row; Ctrl+Home/
 * Ctrl+End jump to the first/last cell of the whole grid. PageUp/PageDown
 * step a fixed stride of rows in the same column. Unrecognized keys leave
 * the position unchanged.
 */
export function nextCellForKey(
  pos: CellPos,
  key: string,
  rowCount: number,
  colCount: number,
  shiftKey = false,
  ctrlKey = false,
): CellPos {
  const { row, col } = pos;

  switch (key) {
    case "ArrowUp":
      return { row: Math.max(0, row - 1), col };
    case "ArrowDown":
      return { row: Math.min(rowCount - 1, row + 1), col };
    case "ArrowLeft":
      return { row, col: Math.max(0, col - 1) };
    case "ArrowRight":
      return { row, col: Math.min(colCount - 1, col + 1) };
    case "Home":
      return ctrlKey ? { row: 0, col: 0 } : { row, col: 0 };
    case "End":
      return ctrlKey ? { row: rowCount - 1, col: colCount - 1 } : { row, col: colCount - 1 };
    case "PageUp":
      return { row: Math.max(0, row - PAGE_STRIDE), col };
    case "PageDown":
      return { row: Math.min(rowCount - 1, row + PAGE_STRIDE), col };
    case "Tab":
      return shiftKey ? previousCell(pos, colCount) : nextCell(pos, rowCount, colCount);
    case "Enter":
      return shiftKey
        ? { row: Math.max(0, row - 1), col }
        : { row: Math.min(rowCount - 1, row + 1), col };
    default:
      return pos;
  }
}

function nextCell(pos: CellPos, rowCount: number, colCount: number): CellPos {
  if (pos.col + 1 < colCount) {
    return { row: pos.row, col: pos.col + 1 };
  }
  if (pos.row + 1 < rowCount) {
    return { row: pos.row + 1, col: 0 };
  }
  return pos;
}

function previousCell(pos: CellPos, colCount: number): CellPos {
  if (pos.col - 1 >= 0) {
    return { row: pos.row, col: pos.col - 1 };
  }
  if (pos.row - 1 >= 0) {
    return { row: pos.row - 1, col: colCount - 1 };
  }
  return pos;
}

/**
 * Whether `target` is a form control/editable element that should swallow
 * a bare single-letter key rather than have it interpreted as a scoped
 * grid/list shortcut (ADR-0020's "Scoped bare single-letter shortcuts" --
 * e.g. `j`/`k` to move rows -- must never fire while the user is typing
 * into a text input, textarea, select, or contenteditable region).
 *
 * Screens wire this in like:
 * ```ts
 * function handleKeyDown(e: KeyboardEvent) {
 *   if (isTextInputTarget(e.target)) return;
 *   if (e.key === "j") { ... move focus down ... }
 * }
 * ```
 */
export function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable || target.getAttribute("contenteditable") === "true") {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

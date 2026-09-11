// Pure keyboard-navigation logic for the inline-editable transactions grid.
// Kept free of React/DOM so it can be unit tested directly and reused by any
// future grid-shaped view.

// The old single "description" column has split into a read-only Payee
// column (derived: merchant_name || description) and an editable Memo
// column (the raw description field) -- see issue #68 / ADR-0019. Account,
// Tags, and Running Balance are new, also read-only in this slice.
export type ColumnKey =
  | "date"
  | "account"
  | "payee"
  | "memo"
  | "category"
  | "tags"
  | "amount"
  | "running_balance";

/**
 * The full Column Set, in default left-to-right display order (see
 * CONTEXT.md's "Column Set" glossary entry). Which of these actually render
 * for a given view is filtered by the user's Column Management visibility
 * choices plus the Account-column/Running-Balance suppression rules --
 * see `TransactionsGrid`'s `visibleColumns`.
 */
export const COLUMN_SET: ColumnKey[] = [
  "date",
  "account",
  "payee",
  "memo",
  "category",
  "tags",
  "amount",
  "running_balance",
];

/**
 * Columns that support inline keyboard edit/nav. Payee, Account, Tags, and
 * Running Balance are read-only in this slice (Payee/Tags editing lands in
 * later issues; Account and Running Balance are always derived/computed),
 * so they're rendered as plain display cells and take no part in the
 * focus/edit grid navigation below -- only these four columns occupy a
 * `col` index in `CellPos`.
 */
export const EDITABLE_COLUMNS: ColumnKey[] = ["date", "memo", "category", "amount"];

export interface CellPos {
  row: number;
  col: number;
}

/**
 * Given a focused cell and a key event's `key` (plus whether Shift was
 * held), returns the cell that should become focused next. Movement is
 * clamped to the grid's bounds rather than wrapping past the first/last
 * row, so repeated presses at an edge are no-ops. Tab/Shift+Tab wrap
 * within a row (last column -> first column of next row, and back).
 * Unrecognized keys leave the position unchanged.
 */
export function nextCellForKey(
  pos: CellPos,
  key: string,
  rowCount: number,
  colCount: number,
  shiftKey = false,
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

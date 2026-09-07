// Pure keyboard-navigation logic for the inline-editable transactions grid.
// Kept free of React/DOM so it can be unit tested directly and reused by any
// future grid-shaped view.

export type ColumnKey = "date" | "description" | "category" | "amount";

/** Column order as rendered left-to-right in the grid. */
export const EDITABLE_COLUMNS: ColumnKey[] = ["date", "description", "category", "amount"];

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

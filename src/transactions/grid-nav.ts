// Column definitions for the inline-editable transactions grid. The
// screen-agnostic keyboard-navigation math (arrow keys, Tab/Shift+Tab,
// Enter/Shift+Enter) has moved to `src/ui/grid-nav.ts` so it can be reused
// by other tabular screens (see ADR-0020 and issue #76) -- this module now
// only holds TransactionsGrid's own column vocabulary, which that shared
// primitive knows nothing about.

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

// Re-exported for existing consumers -- the type itself is generic and now
// lives in `src/ui/grid-nav.ts` alongside the nav math that operates on it.
export type { CellPos } from "../ui/grid-nav";

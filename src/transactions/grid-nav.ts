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
 * Columns that support inline keyboard *editing*. Every visible column --
 * including these -- occupies a `col` index in `CellPos` for focus/navigation
 * (a `col` is an index into the caller's `visibleColumns`), but only these
 * four open the plain draft-input editor on Enter/F2. Payee and Tags are
 * edited through their own id-tracked SuggestionCombobox editors; Account
 * and Running Balance are always derived/computed and hold focus only.
 */
export const EDITABLE_COLUMNS: ColumnKey[] = ["date", "memo", "category", "amount"];

// Field labels for the Column Management checklist (the grid's own
// right-click header menu, and -- as of #90 -- the Function Bar's Columns
// chip popover on AllTransactionsScreen) and the Mobile-tier stacked-card
// layout (ADR-0018), which has no column headers to label cells against.
export const COLUMN_LABELS: Record<ColumnKey, string> = {
  date: "Date",
  account: "Account",
  payee: "Payee",
  memo: "Memo",
  category: "Category",
  tags: "Tags",
  amount: "Amount",
  running_balance: "Running Balance",
};

// Re-exported for existing consumers -- the type itself is generic and now
// lives in `src/ui/grid-nav.ts` alongside the nav math that operates on it.
export type { CellPos } from "../ui/grid-nav";

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

// Column reorder (#94, ADR-0021 phase 5): pure helpers over a full Column
// Set ordering (every column, not just the currently-visible ones -- see
// TransactionsGrid's `visibleColumns`, which filters this order down by
// `columnVisibility` rather than the other way around). Kept alongside
// COLUMN_SET/COLUMN_LABELS above so column vocabulary and column-order math
// live in one module.

/**
 * Resolves a stored column order (as persisted -- see
 * `services::settings::Settings.transaction_column_order`, plain strings so
 * an unrecognized value never fails backend deserialization) into a valid,
 * complete `ColumnKey[]` the grid can render from.
 *
 * - `undefined`/empty (a pre-#94 settings.json, or a user who's never
 *   reordered) falls back to `COLUMN_SET`'s declaration order.
 * - Unrecognized entries (a stale column key from a future/older version)
 *   are dropped.
 * - Any `COLUMN_SET` member missing from `stored` (a column added after the
 *   user's order was saved, or dropped by the rule above) is appended at
 *   the end, in `COLUMN_SET`'s own order -- so a newly-introduced column
 *   always appears rather than silently vanishing from the grid.
 */
export function resolveColumnOrder(stored: string[] | null | undefined): ColumnKey[] {
  if (!stored || stored.length === 0) return [...COLUMN_SET];
  const isColumnKey = (value: string): value is ColumnKey =>
    (COLUMN_SET as string[]).includes(value);
  const known = stored.filter(isColumnKey);
  const deduped = Array.from(new Set(known));
  const missing = COLUMN_SET.filter((column) => !deduped.includes(column));
  return [...deduped, ...missing];
}

/**
 * Drag-to-reorder (#94): moves `dragged` to just before `target` in `order`,
 * used when a column header's drag handle is dropped onto another header.
 * A no-op (returns `order` unchanged, same reference) when `dragged`/
 * `target` are the same column or `target` isn't present.
 */
export function moveColumnBefore(order: ColumnKey[], dragged: ColumnKey, target: ColumnKey): ColumnKey[] {
  if (dragged === target) return order;
  const without = order.filter((column) => column !== dragged);
  const targetIndex = without.indexOf(target);
  if (targetIndex === -1) return order;
  return [...without.slice(0, targetIndex), dragged, ...without.slice(targetIndex)];
}

/**
 * Up/down reordering (#94): the Columns chip panel's move controls swap
 * `column` with its immediate neighbor in the given direction. A no-op at
 * either end of `order` (already first and moving up, or already last and
 * moving down).
 */
export function moveColumnByOffset(
  order: ColumnKey[],
  column: ColumnKey,
  direction: "up" | "down",
): ColumnKey[] {
  const index = order.indexOf(column);
  if (index === -1) return order;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= order.length) return order;
  const next = [...order];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

// Pure, screen-agnostic filter model for the Transactions grid (#91, ADR-0021
// "Rejected chrome": header-driven filtering instead of a Filter Rail
// sidebar). Computed entirely client-side over the already-fetched dataset
// -- no backend involvement. Kept free of React/DOM so it can be unit
// tested directly and reused by both AllTransactionsScreen (state + wiring)
// and TransactionsGrid (which columns are filterable at all).
//
// Two independent facet groups compose via AND:
//  - Column filters (right-click a header): OR within a column's selected
//    values, AND across columns. The Date column is a single preset choice
//    rather than a value checklist.
//  - Cross-cutting facets (the Filters chip's popover): Type
//    (income/expense/transfer, OR within the set) and Show Hidden.
import { Transaction } from "./types";
import { ColumnKey, COLUMN_LABELS } from "./grid-nav";

// Only these five columns get a right-click filter menu at all (Amount,
// Memo, and Running Balance do not -- see #91's acceptance criteria; Memo
// stays reachable via search once it lands, #92).
export type FilterableColumn = Extract<ColumnKey, "date" | "account" | "payee" | "category" | "tags">;
export const FILTERABLE_COLUMNS: FilterableColumn[] = ["date", "account", "payee", "category", "tags"];

export function isFilterableColumn(column: ColumnKey): column is FilterableColumn {
  return (FILTERABLE_COLUMNS as ColumnKey[]).includes(column);
}

// Non-date filterable columns: the ones that get a distinct-values
// checklist. Date instead gets a preset range (see DatePreset below).
export type ChecklistColumn = Exclude<FilterableColumn, "date">;
export const CHECKLIST_COLUMNS: ChecklistColumn[] = ["account", "payee", "category", "tags"];

export type DatePreset = "this_month" | "last_month" | "this_year" | "all";
export const DATE_PRESETS: DatePreset[] = ["this_month", "last_month", "this_year", "all"];
export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  all: "All dates",
};

export type TransactionTypeFacet = "income" | "expense" | "transfer";
export const TRANSACTION_TYPE_FACETS: TransactionTypeFacet[] = ["income", "expense", "transfer"];

// A Transaction enriched with the display fields the filter model facets/
// matches against -- Account name, Payee, Category name, Tag names, and
// whether it's part of a linked Transfer. AllTransactionsScreen already
// resolves all of these for rendering (account_name, merchant_name ||
// description, categoryNameById, tagsByTransactionId,
// linkedTransactionIds) -- this module takes them as plain data rather than
// reaching into those lookup maps itself, keeping it React/backend-free.
export interface FilterableRow {
  transaction: Transaction;
  accountName: string;
  payeeName: string;
  categoryName: string;
  tagNames: string[];
  isTransfer: boolean;
}

export type ColumnFilterState = Partial<Record<ChecklistColumn, Set<string>>>;

export interface FilterState {
  columns: ColumnFilterState;
  datePreset: DatePreset;
  types: Set<TransactionTypeFacet>;
  showHidden: boolean;
}

export function emptyFilterState(): FilterState {
  return { columns: {}, datePreset: "all", types: new Set(), showHidden: false };
}

// Transfers are classified by their link, not their sign -- a linked
// Transaction is "transfer" regardless of whether it's the debit or credit
// leg. Everything else falls back to sign: non-negative is Income,
// negative is Expense (matches the Quote Strip's own Income/Expense split).
export function transactionTypeFacet(row: FilterableRow): TransactionTypeFacet {
  if (row.isTransfer) return "transfer";
  return row.transaction.amount_cents >= 0 ? "income" : "expense";
}

// Tags is the one multi-valued column -- a row can match a column filter
// via any one of its Tags (OR within the column still holds: any selected
// Tag name present on the row is a match).
export function columnValues(row: FilterableRow, column: ChecklistColumn): string[] {
  switch (column) {
    case "account":
      return [row.accountName];
    case "payee":
      return [row.payeeName];
    case "category":
      return [row.categoryName];
    case "tags":
      return row.tagNames;
  }
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// Inclusive [start, end] ISO date bounds for a preset, relative to `now`.
// `null` for "all" -- there is no range to bound.
export function datePresetRange(preset: DatePreset, now: Date = new Date()): { start: string; end: string } | null {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (preset) {
    case "all":
      return null;
    case "this_month":
      return { start: iso(year, month, 1), end: iso(year, month, lastDayOfMonth(year, month)) };
    case "last_month": {
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      return { start: iso(y, m, 1), end: iso(y, m, lastDayOfMonth(y, m)) };
    }
    case "this_year":
      return { start: iso(year, 0, 1), end: iso(year, 11, 31) };
  }
}

export function matchesDatePreset(dateIso: string, preset: DatePreset, now: Date = new Date()): boolean {
  const range = datePresetRange(preset, now);
  if (!range) return true;
  return dateIso >= range.start && dateIso <= range.end;
}

// AND across columns; OR within each column's selected value set. A column
// absent from `columns`, or present with an empty set, applies no
// constraint.
export function matchesColumnFilters(row: FilterableRow, columns: ColumnFilterState): boolean {
  for (const column of CHECKLIST_COLUMNS) {
    const selected = columns[column];
    if (!selected || selected.size === 0) continue;
    const values = columnValues(row, column);
    if (!values.some((v) => selected.has(v))) return false;
  }
  return true;
}

// OR within the Type facet's selected set; an empty set applies no
// constraint (matches every Type).
export function matchesTypeFacet(row: FilterableRow, types: Set<TransactionTypeFacet>): boolean {
  if (types.size === 0) return true;
  return types.has(transactionTypeFacet(row));
}

// The full AND composition: Show Hidden, Date preset, Type, and every
// column filter all have to pass for a row to be visible.
export function matchesFilters(row: FilterableRow, filters: FilterState, now: Date = new Date()): boolean {
  if (!filters.showHidden && row.transaction.hidden) return false;
  if (!matchesDatePreset(row.transaction.date, filters.datePreset, now)) return false;
  if (!matchesTypeFacet(row, filters.types)) return false;
  if (!matchesColumnFilters(row, filters.columns)) return false;
  return true;
}

export function applyFilters(rows: FilterableRow[], filters: FilterState, now: Date = new Date()): FilterableRow[] {
  return rows.filter((row) => matchesFilters(row, filters, now));
}

export interface ValueCount {
  value: string;
  count: number;
}

// Distinct values + counts for one checklist column's filter menu. Callers
// should pass in `rows` already narrowed by every *other* active facet
// (every other column, Type, Show Hidden -- but not this column's own
// filter), so counts answer "how many rows would remain if I picked this
// value" (Excel/Bloomberg-style faceting) rather than a static snapshot of
// the whole dataset. Tags is multi-valued: a row with two Tags contributes
// to two counts. Sorted alphabetically for a stable, scannable menu.
export function distinctValueCounts(rows: FilterableRow[], column: ChecklistColumn): ValueCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of columnValues(row, column)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function hasActiveFilters(filters: FilterState): boolean {
  return activeFilterCount(filters) > 0;
}

export function activeFilterCount(filters: FilterState): number {
  let count = 0;
  if (filters.showHidden) count++;
  if (filters.datePreset !== "all") count++;
  if (filters.types.size > 0) count++;
  for (const column of CHECKLIST_COLUMNS) {
    const selected = filters.columns[column];
    if (selected && selected.size > 0) count++;
  }
  return count;
}

export function toggleColumnValue(filters: FilterState, column: ChecklistColumn, value: string): FilterState {
  const current = new Set(filters.columns[column] ?? []);
  if (current.has(value)) {
    current.delete(value);
  } else {
    current.add(value);
  }
  return { ...filters, columns: { ...filters.columns, [column]: current } };
}

export function clearColumnFilter(filters: FilterState, column: ChecklistColumn): FilterState {
  return { ...filters, columns: { ...filters.columns, [column]: new Set() } };
}

export function toggleTypeFacet(filters: FilterState, type: TransactionTypeFacet): FilterState {
  const current = new Set(filters.types);
  if (current.has(type)) {
    current.delete(type);
  } else {
    current.add(type);
  }
  return { ...filters, types: current };
}

export function setDatePreset(filters: FilterState, preset: DatePreset): FilterState {
  return { ...filters, datePreset: preset };
}

export function setShowHidden(filters: FilterState, showHidden: boolean): FilterState {
  return { ...filters, showHidden };
}

// Status Bar's left-side active-filter summary (#91): a short, human
// readable line built from whichever facets are active, or `null` when
// none are (Status Bar renders nothing extra in that case).
export function filterSummary(filters: FilterState): string | null {
  if (!hasActiveFilters(filters)) return null;
  const parts: string[] = [];
  if (filters.types.size > 0) {
    parts.push(`Type: ${Array.from(filters.types).join(", ")}`);
  }
  if (filters.datePreset !== "all") {
    parts.push(DATE_PRESET_LABELS[filters.datePreset]);
  }
  if (filters.showHidden) {
    parts.push("Hidden shown");
  }
  for (const column of CHECKLIST_COLUMNS) {
    const selected = filters.columns[column];
    if (selected && selected.size > 0) {
      parts.push(`${COLUMN_LABELS[column]}: ${selected.size}`);
    }
  }
  return parts.join(" · ");
}

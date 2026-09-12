// Pure, screen-agnostic live search over the Transactions grid (#92,
// ADR-0021 "Copied chrome": the Context Bar's search input). Composes with
// the filter model (filters.ts) via AND, same as every other facet --
// callers narrow by search and by `applyFilters` independently, in either
// order, since both are pure predicates over `FilterableRow`. Kept free of
// React/DOM so it's unit testable on its own, same rationale as filters.ts.
//
// Matches a case-insensitive substring across five fields: Payee (the
// resolved merchant_name || description FilterableRow already carries),
// the raw imported/edited description (Transaction.description -- the same
// field the Memo column renders), Category name, and every attached Tag
// name. An empty/whitespace-only term matches every row (no-op narrowing).
import { FilterableRow } from "./filters";

export function matchesSearch(row: FilterableRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle === "") return true;
  if (row.payeeName.toLowerCase().includes(needle)) return true;
  if (row.transaction.description.toLowerCase().includes(needle)) return true;
  if (row.categoryName.toLowerCase().includes(needle)) return true;
  return row.tagNames.some((tag) => tag.toLowerCase().includes(needle));
}

export function applySearch(rows: FilterableRow[], term: string): FilterableRow[] {
  if (term.trim() === "") return rows;
  return rows.filter((row) => matchesSearch(row, term));
}

import { describe, expect, it } from "vitest";
import {
  FilterableRow,
  applyFilters,
  activeFilterCount,
  clearColumnFilter,
  datePresetRange,
  distinctValueCounts,
  emptyFilterState,
  filterSummary,
  hasActiveFilters,
  matchesColumnFilters,
  matchesDatePreset,
  matchesFilters,
  matchesTypeFacet,
  setDatePreset,
  setShowHidden,
  toggleColumnValue,
  toggleTypeFacet,
  transactionTypeFacet,
} from "./filters";
import { Transaction } from "./types";

function makeTransaction(overrides: Partial<Transaction> & { id: number }): Transaction {
  return {
    account_id: 1,
    date: "2026-06-15",
    amount_cents: -1000,
    description: "Test",
    category_id: null,
    merchant_name: null,
    hidden: false,
    ...overrides,
  };
}

function makeRow(overrides: Partial<FilterableRow> & { transaction: Transaction }): FilterableRow {
  return {
    accountName: "Checking",
    payeeName: overrides.transaction.merchant_name || overrides.transaction.description,
    categoryName: "Uncategorized",
    tagNames: [],
    isTransfer: false,
    ...overrides,
  };
}

describe("transactionTypeFacet", () => {
  it("classifies a positive-amount non-transfer row as income", () => {
    const row = makeRow({ transaction: makeTransaction({ id: 1, amount_cents: 500 }) });
    expect(transactionTypeFacet(row)).toBe("income");
  });

  it("classifies a negative-amount non-transfer row as expense", () => {
    const row = makeRow({ transaction: makeTransaction({ id: 1, amount_cents: -500 }) });
    expect(transactionTypeFacet(row)).toBe("expense");
  });

  it("classifies a linked row as transfer regardless of sign", () => {
    const positive = makeRow({ transaction: makeTransaction({ id: 1, amount_cents: 500 }), isTransfer: true });
    const negative = makeRow({ transaction: makeTransaction({ id: 2, amount_cents: -500 }), isTransfer: true });
    expect(transactionTypeFacet(positive)).toBe("transfer");
    expect(transactionTypeFacet(negative)).toBe("transfer");
  });
});

describe("datePresetRange / matchesDatePreset", () => {
  const now = new Date(2026, 5, 15); // June 15, 2026 (month is 0-indexed)

  it("returns null for 'all' (no bound)", () => {
    expect(datePresetRange("all", now)).toBeNull();
  });

  it("bounds 'this_month' to the calendar month", () => {
    expect(datePresetRange("this_month", now)).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });

  it("bounds 'last_month' to the previous calendar month", () => {
    expect(datePresetRange("last_month", now)).toEqual({ start: "2026-05-01", end: "2026-05-31" });
  });

  it("rolls 'last_month' across a year boundary in January", () => {
    const jan = new Date(2026, 0, 10);
    expect(datePresetRange("last_month", jan)).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("bounds 'this_year' to the calendar year", () => {
    expect(datePresetRange("this_year", now)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
  });

  it("matchesDatePreset respects the computed range inclusively", () => {
    expect(matchesDatePreset("2026-06-01", "this_month", now)).toBe(true);
    expect(matchesDatePreset("2026-06-30", "this_month", now)).toBe(true);
    expect(matchesDatePreset("2026-07-01", "this_month", now)).toBe(false);
    expect(matchesDatePreset("2026-05-31", "this_month", now)).toBe(false);
  });

  it("matchesDatePreset always matches for 'all'", () => {
    expect(matchesDatePreset("1999-01-01", "all", now)).toBe(true);
  });
});

describe("matchesColumnFilters", () => {
  const row = makeRow({
    transaction: makeTransaction({ id: 1 }),
    accountName: "Checking",
    payeeName: "Coffee Shop",
    categoryName: "Dining",
    tagNames: ["Reimbursable", "Work"],
  });

  it("matches everything when no column filters are set", () => {
    expect(matchesColumnFilters(row, {})).toBe(true);
  });

  it("OR's within a single column's selected values", () => {
    expect(matchesColumnFilters(row, { account: new Set(["Checking", "Savings"]) })).toBe(true);
    expect(matchesColumnFilters(row, { account: new Set(["Savings"]) })).toBe(false);
  });

  it("matches a multi-valued Tags column via any selected tag", () => {
    expect(matchesColumnFilters(row, { tags: new Set(["Work"]) })).toBe(true);
    expect(matchesColumnFilters(row, { tags: new Set(["Groceries"]) })).toBe(false);
  });

  it("AND's across multiple columns", () => {
    expect(
      matchesColumnFilters(row, {
        account: new Set(["Checking"]),
        category: new Set(["Dining"]),
      }),
    ).toBe(true);
    expect(
      matchesColumnFilters(row, {
        account: new Set(["Checking"]),
        category: new Set(["Groceries"]),
      }),
    ).toBe(false);
  });

  it("treats an empty selected set as no constraint", () => {
    expect(matchesColumnFilters(row, { account: new Set() })).toBe(true);
  });
});

describe("matchesTypeFacet", () => {
  it("matches every type when the set is empty", () => {
    const row = makeRow({ transaction: makeTransaction({ id: 1, amount_cents: -500 }) });
    expect(matchesTypeFacet(row, new Set())).toBe(true);
  });

  it("matches only the selected types otherwise", () => {
    const expenseRow = makeRow({ transaction: makeTransaction({ id: 1, amount_cents: -500 }) });
    const incomeRow = makeRow({ transaction: makeTransaction({ id: 2, amount_cents: 500 }) });
    expect(matchesTypeFacet(expenseRow, new Set(["expense"]))).toBe(true);
    expect(matchesTypeFacet(incomeRow, new Set(["expense"]))).toBe(false);
  });
});

describe("matchesFilters (full composition)", () => {
  const now = new Date(2026, 5, 15);

  it("hides a hidden transaction unless showHidden is set", () => {
    const row = makeRow({ transaction: makeTransaction({ id: 1, hidden: true }) });
    expect(matchesFilters(row, emptyFilterState(), now)).toBe(false);
    expect(matchesFilters(row, setShowHidden(emptyFilterState(), true), now)).toBe(true);
  });

  it("ANDs Show Hidden, Date preset, Type, and column filters together", () => {
    const row = makeRow({
      transaction: makeTransaction({ id: 1, date: "2026-06-10", amount_cents: -500 }),
      accountName: "Checking",
    });
    let filters = emptyFilterState();
    filters = setDatePreset(filters, "this_month");
    filters = toggleTypeFacet(filters, "expense");
    filters = toggleColumnValue(filters, "account", "Checking");
    expect(matchesFilters(row, filters, now)).toBe(true);

    // Flip one facet to a non-matching value -- the whole thing should fail.
    const wrongAccount = toggleColumnValue(toggleColumnValue(filters, "account", "Checking"), "account", "Savings");
    expect(matchesFilters(row, wrongAccount, now)).toBe(false);
  });

  it("applyFilters filters an array of rows down to matches", () => {
    const rows = [
      makeRow({ transaction: makeTransaction({ id: 1, amount_cents: 500 }) }),
      makeRow({ transaction: makeTransaction({ id: 2, amount_cents: -500 }) }),
    ];
    const filters = toggleTypeFacet(emptyFilterState(), "income");
    const result = applyFilters(rows, filters, now);
    expect(result.map((r) => r.transaction.id)).toEqual([1]);
  });
});

describe("distinctValueCounts", () => {
  it("counts distinct values for a single-valued column", () => {
    const rows = [
      makeRow({ transaction: makeTransaction({ id: 1 }), accountName: "Checking" }),
      makeRow({ transaction: makeTransaction({ id: 2 }), accountName: "Checking" }),
      makeRow({ transaction: makeTransaction({ id: 3 }), accountName: "Savings" }),
    ];
    expect(distinctValueCounts(rows, "account")).toEqual([
      { value: "Checking", count: 2 },
      { value: "Savings", count: 1 },
    ]);
  });

  it("counts a multi-valued Tags column per tag, not per row", () => {
    const rows = [
      makeRow({ transaction: makeTransaction({ id: 1 }), tagNames: ["Work", "Reimbursable"] }),
      makeRow({ transaction: makeTransaction({ id: 2 }), tagNames: ["Work"] }),
    ];
    expect(distinctValueCounts(rows, "tags")).toEqual([
      { value: "Reimbursable", count: 1 },
      { value: "Work", count: 2 },
    ]);
  });

  it("returns an empty list for an empty input", () => {
    expect(distinctValueCounts([], "category")).toEqual([]);
  });
});

describe("active-filter bookkeeping", () => {
  it("hasActiveFilters/activeFilterCount are false/0 for the empty state", () => {
    expect(hasActiveFilters(emptyFilterState())).toBe(false);
    expect(activeFilterCount(emptyFilterState())).toBe(0);
  });

  it("counts each active facet independently", () => {
    let filters = emptyFilterState();
    filters = setShowHidden(filters, true);
    filters = setDatePreset(filters, "this_year");
    filters = toggleTypeFacet(filters, "income");
    filters = toggleColumnValue(filters, "account", "Checking");
    expect(activeFilterCount(filters)).toBe(4);
    expect(hasActiveFilters(filters)).toBe(true);
  });

  it("clearColumnFilter resets just that column", () => {
    let filters = toggleColumnValue(emptyFilterState(), "account", "Checking");
    filters = toggleColumnValue(filters, "category", "Dining");
    filters = clearColumnFilter(filters, "account");
    expect(filters.columns.account?.size).toBe(0);
    expect(filters.columns.category?.size).toBe(1);
  });

  it("toggleColumnValue toggles a value off on a second call", () => {
    let filters = toggleColumnValue(emptyFilterState(), "account", "Checking");
    expect(filters.columns.account?.has("Checking")).toBe(true);
    filters = toggleColumnValue(filters, "account", "Checking");
    expect(filters.columns.account?.has("Checking")).toBe(false);
  });

  it("toggleTypeFacet toggles a type off on a second call", () => {
    let filters = toggleTypeFacet(emptyFilterState(), "expense");
    expect(filters.types.has("expense")).toBe(true);
    filters = toggleTypeFacet(filters, "expense");
    expect(filters.types.has("expense")).toBe(false);
  });
});

describe("filterSummary", () => {
  it("returns null when nothing is active", () => {
    expect(filterSummary(emptyFilterState())).toBeNull();
  });

  it("describes every active facet", () => {
    let filters = emptyFilterState();
    filters = toggleTypeFacet(filters, "expense");
    filters = setDatePreset(filters, "this_month");
    filters = setShowHidden(filters, true);
    filters = toggleColumnValue(filters, "account", "Checking");
    const summary = filterSummary(filters);
    expect(summary).toContain("expense");
    expect(summary).toContain("This month");
    expect(summary).toContain("Hidden shown");
    expect(summary).toContain("Account: 1");
  });
});

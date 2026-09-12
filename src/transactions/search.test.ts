import { describe, expect, it } from "vitest";
import { FilterableRow } from "./filters";
import { Transaction } from "./types";
import { applySearch, matchesSearch } from "./search";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    account_id: 1,
    date: "2026-09-01",
    amount_cents: -1250,
    description: "Coffee shop downtown",
    category_id: null,
    merchant_name: null,
    hidden: false,
    ...overrides,
  };
}

function row(overrides: Partial<FilterableRow> = {}): FilterableRow {
  return {
    transaction: transaction(),
    accountName: "Checking",
    payeeName: "Neighborhood Cafe",
    categoryName: "Dining",
    tagNames: ["Reimbursable", "Work"],
    isTransfer: false,
    ...overrides,
  };
}

describe("matchesSearch", () => {
  it("matches an empty/whitespace term against every row", () => {
    expect(matchesSearch(row(), "")).toBe(true);
    expect(matchesSearch(row(), "   ")).toBe(true);
  });

  it("matches a substring of the Payee name, case-insensitively", () => {
    expect(matchesSearch(row(), "cafe")).toBe(true);
    expect(matchesSearch(row(), "CAFE")).toBe(true);
    expect(matchesSearch(row(), "gas station")).toBe(false);
  });

  it("matches a substring of the raw imported description (the Memo field)", () => {
    expect(matchesSearch(row({ transaction: transaction({ description: "ACME CORP #4471" }) }), "acme")).toBe(
      true,
    );
  });

  it("matches a substring of the Category name", () => {
    expect(matchesSearch(row({ categoryName: "Groceries" }), "grocer")).toBe(true);
    expect(matchesSearch(row({ categoryName: "Groceries" }), "dining")).toBe(false);
  });

  it("matches a substring of any attached Tag name", () => {
    expect(matchesSearch(row({ tagNames: ["Vacation", "2026"] }), "vacation")).toBe(true);
    expect(matchesSearch(row({ tagNames: ["Vacation", "2026"] }), "2026")).toBe(true);
    expect(matchesSearch(row({ tagNames: [] }), "vacation")).toBe(false);
  });

  it("does not match a term found in no field", () => {
    expect(matchesSearch(row(), "zzz-nonexistent")).toBe(false);
  });
});

describe("applySearch", () => {
  it("returns every row unfiltered for an empty term", () => {
    const rows = [row(), row({ payeeName: "Other" })];
    expect(applySearch(rows, "")).toEqual(rows);
  });

  it("narrows to only the rows matching the term", () => {
    const cafeRow = row({ payeeName: "Neighborhood Cafe" });
    const gasRow = row({ payeeName: "Gas Station", categoryName: "Auto", tagNames: [] });
    expect(applySearch([cafeRow, gasRow], "cafe")).toEqual([cafeRow]);
  });
});

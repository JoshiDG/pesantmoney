import { describe, expect, it } from "vitest";
import { COLUMN_SET, ColumnKey, moveColumnBefore, moveColumnByOffset, resolveColumnOrder } from "./grid-nav";

// Column reorder pure logic (#94, ADR-0021 phase 5). See TransactionsGrid.test.tsx
// and AllTransactionsScreen.test.tsx for the drag-interaction/persistence coverage
// on top of this module.
describe("resolveColumnOrder", () => {
  it("falls back to COLUMN_SET's declaration order when stored is undefined", () => {
    expect(resolveColumnOrder(undefined)).toEqual(COLUMN_SET);
  });

  it("falls back to COLUMN_SET's declaration order when stored is null", () => {
    expect(resolveColumnOrder(null)).toEqual(COLUMN_SET);
  });

  it("falls back to COLUMN_SET's declaration order when stored is empty", () => {
    expect(resolveColumnOrder([])).toEqual(COLUMN_SET);
  });

  it("returns a full, valid order unchanged", () => {
    const reordered = ["amount", "date", "account", "payee", "memo", "category", "tags", "running_balance"];
    expect(resolveColumnOrder(reordered)).toEqual(reordered);
  });

  it("drops unrecognized entries", () => {
    const stored = ["amount", "bogus_column", "date"];
    const result = resolveColumnOrder(stored);
    expect(result).not.toContain("bogus_column");
  });

  it("appends columns missing from a stale/partial stored order, in COLUMN_SET order", () => {
    const stored = ["amount", "date"];
    const result = resolveColumnOrder(stored);
    expect(result.slice(0, 2)).toEqual(["amount", "date"]);
    // Every remaining COLUMN_SET member appears, in COLUMN_SET's own order.
    const remaining = COLUMN_SET.filter((c) => c !== "amount" && c !== "date");
    expect(result.slice(2)).toEqual(remaining);
    expect(result).toHaveLength(COLUMN_SET.length);
  });

  it("dedupes a stored order containing a repeated column", () => {
    const stored = ["amount", "amount", "date"];
    const result = resolveColumnOrder(stored);
    expect(result.filter((c) => c === "amount")).toHaveLength(1);
    expect(result).toHaveLength(COLUMN_SET.length);
  });
});

describe("moveColumnBefore", () => {
  it("moves the dragged column to just before the target", () => {
    const order: ColumnKey[] = ["date", "account", "payee", "memo"];
    expect(moveColumnBefore(order, "memo", "account")).toEqual(["date", "memo", "account", "payee"]);
  });

  it("moves a column later in the order", () => {
    const order: ColumnKey[] = ["date", "account", "payee", "memo"];
    expect(moveColumnBefore(order, "date", "memo")).toEqual(["account", "payee", "date", "memo"]);
  });

  it("is a no-op when dragged and target are the same column", () => {
    const order: ColumnKey[] = ["date", "account", "payee", "memo"];
    expect(moveColumnBefore(order, "date", "date")).toBe(order);
  });

  it("is a no-op when the target isn't present in order", () => {
    const order: ColumnKey[] = ["date", "account", "payee"];
    expect(moveColumnBefore(order, "date", "amount")).toBe(order);
  });
});

describe("moveColumnByOffset", () => {
  it("swaps a column up with its neighbor", () => {
    const order: ColumnKey[] = ["date", "account", "payee", "memo"];
    expect(moveColumnByOffset(order, "payee", "up")).toEqual(["date", "payee", "account", "memo"]);
  });

  it("swaps a column down with its neighbor", () => {
    const order: ColumnKey[] = ["date", "account", "payee", "memo"];
    expect(moveColumnByOffset(order, "account", "down")).toEqual(["date", "payee", "account", "memo"]);
  });

  it("is a no-op moving the first column up", () => {
    const order: ColumnKey[] = ["date", "account", "payee"];
    expect(moveColumnByOffset(order, "date", "up")).toBe(order);
  });

  it("is a no-op moving the last column down", () => {
    const order: ColumnKey[] = ["date", "account", "payee"];
    expect(moveColumnByOffset(order, "payee", "down")).toBe(order);
  });

  it("is a no-op when the column isn't present in order", () => {
    const order: ColumnKey[] = ["date", "account"];
    expect(moveColumnByOffset(order, "payee", "up")).toBe(order);
  });
});

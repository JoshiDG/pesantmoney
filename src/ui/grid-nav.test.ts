import { describe, expect, it } from "vitest";
import { isTextInputTarget, nextCellForKey } from "./grid-nav";

describe("nextCellForKey", () => {
  const rowCount = 3;
  // 4 columns, matching the editable-column count TransactionsGrid uses
  // (date, memo, category, amount) -- kept as a plain literal here since
  // this module has no knowledge of any particular screen's columns.
  const colCount = 4;

  it("moves down on ArrowDown, clamped at the last row", () => {
    expect(nextCellForKey({ row: 0, col: 1 }, "ArrowDown", rowCount, colCount)).toEqual({
      row: 1,
      col: 1,
    });
    expect(nextCellForKey({ row: 2, col: 1 }, "ArrowDown", rowCount, colCount)).toEqual({
      row: 2,
      col: 1,
    });
  });

  it("moves up on ArrowUp, clamped at the first row", () => {
    expect(nextCellForKey({ row: 1, col: 1 }, "ArrowUp", rowCount, colCount)).toEqual({
      row: 0,
      col: 1,
    });
    expect(nextCellForKey({ row: 0, col: 1 }, "ArrowUp", rowCount, colCount)).toEqual({
      row: 0,
      col: 1,
    });
  });

  it("moves left/right on ArrowLeft/ArrowRight, clamped at row edges", () => {
    expect(nextCellForKey({ row: 0, col: 1 }, "ArrowLeft", rowCount, colCount)).toEqual({
      row: 0,
      col: 0,
    });
    expect(nextCellForKey({ row: 0, col: 0 }, "ArrowLeft", rowCount, colCount)).toEqual({
      row: 0,
      col: 0,
    });
    expect(nextCellForKey({ row: 0, col: 2 }, "ArrowRight", rowCount, colCount)).toEqual({
      row: 0,
      col: 3,
    });
    expect(nextCellForKey({ row: 0, col: 3 }, "ArrowRight", rowCount, colCount)).toEqual({
      row: 0,
      col: 3,
    });
  });

  it("Tab moves right and wraps to the first column of the next row", () => {
    expect(nextCellForKey({ row: 0, col: 3 }, "Tab", rowCount, colCount)).toEqual({
      row: 1,
      col: 0,
    });
    expect(nextCellForKey({ row: 0, col: 1 }, "Tab", rowCount, colCount)).toEqual({
      row: 0,
      col: 2,
    });
  });

  it("Tab is clamped at the very last cell of the grid", () => {
    expect(nextCellForKey({ row: 2, col: 3 }, "Tab", rowCount, colCount)).toEqual({
      row: 2,
      col: 3,
    });
  });

  it("Shift+Tab moves left and wraps to the last column of the previous row", () => {
    expect(nextCellForKey({ row: 1, col: 0 }, "Tab", rowCount, colCount, true)).toEqual({
      row: 0,
      col: 3,
    });
    expect(nextCellForKey({ row: 0, col: 1 }, "Tab", rowCount, colCount, true)).toEqual({
      row: 0,
      col: 0,
    });
  });

  it("Shift+Tab is clamped at the very first cell of the grid", () => {
    expect(nextCellForKey({ row: 0, col: 0 }, "Tab", rowCount, colCount, true)).toEqual({
      row: 0,
      col: 0,
    });
  });

  it("Enter moves down (commit and advance), clamped at the last row", () => {
    expect(nextCellForKey({ row: 0, col: 2 }, "Enter", rowCount, colCount)).toEqual({
      row: 1,
      col: 2,
    });
    expect(nextCellForKey({ row: 2, col: 2 }, "Enter", rowCount, colCount)).toEqual({
      row: 2,
      col: 2,
    });
  });

  it("Shift+Enter moves up, clamped at the first row", () => {
    expect(nextCellForKey({ row: 1, col: 2 }, "Enter", rowCount, colCount, true)).toEqual({
      row: 0,
      col: 2,
    });
    expect(nextCellForKey({ row: 0, col: 2 }, "Enter", rowCount, colCount, true)).toEqual({
      row: 0,
      col: 2,
    });
  });

  it("returns the same position for an unrecognized key", () => {
    expect(nextCellForKey({ row: 1, col: 1 }, "a", rowCount, colCount)).toEqual({
      row: 1,
      col: 1,
    });
  });

  it("handles a single-row grid without going out of bounds", () => {
    expect(nextCellForKey({ row: 0, col: 0 }, "ArrowDown", 1, colCount)).toEqual({
      row: 0,
      col: 0,
    });
    expect(nextCellForKey({ row: 0, col: 3 }, "Tab", 1, colCount)).toEqual({ row: 0, col: 3 });
  });
});

describe("isTextInputTarget", () => {
  it("returns false for null/non-element targets", () => {
    expect(isTextInputTarget(null)).toBe(false);
  });

  it("returns false for a plain element like a div", () => {
    expect(isTextInputTarget(document.createElement("div"))).toBe(false);
  });

  it.each(["input", "textarea", "select"])("returns true for a %s element", (tagName) => {
    expect(isTextInputTarget(document.createElement(tagName))).toBe(true);
  });

  it("returns true for a contenteditable element", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    expect(isTextInputTarget(el)).toBe(true);
  });
});

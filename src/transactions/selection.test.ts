import { describe, expect, it } from "vitest";
import { selectRowRange, toggleRowSelection } from "./selection";

describe("toggleRowSelection", () => {
  it("adds an id that isn't selected yet", () => {
    const result = toggleRowSelection(new Set([1, 2]), 3);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it("removes an id that is already selected", () => {
    const result = toggleRowSelection(new Set([1, 2, 3]), 2);
    expect(result).toEqual(new Set([1, 3]));
  });

  it("does not mutate the input set", () => {
    const input = new Set([1]);
    toggleRowSelection(input, 2);
    expect(input).toEqual(new Set([1]));
  });
});

describe("selectRowRange", () => {
  const orderedIds = [10, 20, 30, 40, 50];

  it("selects every id between fromId and toId inclusive, forwards", () => {
    const result = selectRowRange(orderedIds, 20, 40);
    expect(result).toEqual(new Set([20, 30, 40]));
  });

  it("selects every id between fromId and toId inclusive, backwards", () => {
    const result = selectRowRange(orderedIds, 40, 20);
    expect(result).toEqual(new Set([20, 30, 40]));
  });

  it("selects a single id when fromId equals toId", () => {
    const result = selectRowRange(orderedIds, 30, 30);
    expect(result).toEqual(new Set([30]));
  });

  it("falls back to just toId when fromId is not in the ordered list", () => {
    const result = selectRowRange(orderedIds, 999, 30);
    expect(result).toEqual(new Set([30]));
  });
});

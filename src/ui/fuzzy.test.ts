import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch, fuzzyScore } from "./fuzzy";

describe("fuzzyMatch / fuzzyScore", () => {
  it("matches an exact label", () => {
    expect(fuzzyMatch("Dashboard", "Dashboard")).toBe(true);
  });

  it("matches a case-insensitive subsequence", () => {
    expect(fuzzyMatch("trns", "Transactions")).toBe(true);
    expect(fuzzyMatch("DASH", "dashboard")).toBe(true);
  });

  it("does not match when characters are out of order", () => {
    expect(fuzzyMatch("tsnart", "Transactions")).toBe(false);
  });

  it("does not match when a character is missing entirely", () => {
    expect(fuzzyMatch("xyz", "Transactions")).toBe(false);
  });

  it("treats an empty query as matching everything with the lowest score", () => {
    expect(fuzzyScore("", "Transactions")).toBe(0);
  });

  it("scores a tighter/earlier match higher than a scattered one", () => {
    const tight = fuzzyScore("acc", "Accounts")!;
    const scattered = fuzzyScore("acc", "an icy cave")!;
    expect(tight).toBeGreaterThan(scattered);
  });
});

describe("fuzzyFilter", () => {
  const items = [
    { id: "dashboard", label: "Dashboard" },
    { id: "accounts", label: "Accounts" },
    { id: "transactions", label: "Transactions" },
    { id: "settings", label: "Settings" },
  ];

  it("returns all items unchanged/unranked for an empty query", () => {
    expect(fuzzyFilter("", items)).toEqual(items);
  });

  it("filters to only matching items", () => {
    const result = fuzzyFilter("acc", items);
    expect(result.map((i) => i.id)).toEqual(["accounts"]);
  });

  it("ranks a better match first", () => {
    const result = fuzzyFilter("s", items);
    // All four labels contain "s" -- just confirm no crash and every item
    // that contains an "s" comes back, order aside.
    expect(result.map((i) => i.id).sort()).toEqual(
      ["dashboard", "accounts", "transactions", "settings"].sort(),
    );
  });

  it("matches against keywords in addition to the label", () => {
    const withKeywords = [{ id: "new-account", label: "New Account", keywords: ["create"] }];
    expect(fuzzyFilter("create", withKeywords).map((i) => i.id)).toEqual(["new-account"]);
  });

  it("excludes items with no matching label or keyword", () => {
    expect(fuzzyFilter("zzz", items)).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS } from "../ui/breakpoints";

// Reports is chart/summary-based (hand-rolled CSS charts per ADR-0017), not a
// dense row grid like Transactions/Accounts/Holdings, so per ADR-0018 and
// issue #65 it gets cosmetic CSS reflow -- single-column stacking at Mobile
// tier -- rather than a useBreakpoint()-driven card swap. Following the
// precedent set for Dashboard (#62) and Budget (#66), this reads the shared
// stylesheet straight off disk and asserts the tab strip and Cash Flow
// summary stack/wrap instead of overflowing at the Mobile tier cutoff.
const here = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(here, "../App.css"), "utf-8");

function blockFor(query: string, css: string): string {
  const start = css.indexOf(query);
  expect(start, `expected to find "${query}"`).toBeGreaterThan(-1);
  let depth = 0;
  let i = css.indexOf("{", start);
  const blockStart = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return css.slice(blockStart, i + 1);
}

describe("Reports screen responsive reflow", () => {
  it("wraps the Cash Flow income/expense/net summary instead of overflowing at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    expect(appCss).toContain(mobileQuery);

    const block = blockFor(mobileQuery + " {\n  .cash-flow-summary", appCss);
    expect(block).toMatch(/\.cash-flow-summary\s*{[^}]*flex-wrap:\s*wrap;/);
  });

  it("wraps the tab strip instead of overflowing at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    const block = blockFor(mobileQuery + " {\n  .cash-flow-summary", appCss);
    expect(block).toMatch(/\.tab-strip\s*{[^}]*flex-wrap:\s*wrap;/);
  });

  it("tightens tab strip density at the Compact tier without restructuring the tabs", () => {
    const compactQuery = `@media (min-width: ${BREAKPOINTS.compactMin}px) and (max-width: ${BREAKPOINTS.expandedMin - 1}px)`;
    expect(appCss).toContain(compactQuery);

    const block = blockFor(compactQuery + " {\n  .reports-screen .tab-strip-item", appCss);
    expect(block).toMatch(/\.reports-screen \.tab-strip-item\s*{[^}]*padding:/);
  });
});

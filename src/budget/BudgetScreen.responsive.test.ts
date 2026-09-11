import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS } from "../ui/breakpoints";

// Budget's reflow is pure cosmetic CSS per ADR-0018 -- it isn't one of the
// dense-row screens (Transactions/Accounts/Holdings) that get a bespoke
// mobile card conversion, so there's no useBreakpoint()-driven DOM swap to
// assert against. Following the precedent set for the Dashboard grid
// (issue #62's "or the equivalent CSS-driven check" allowance), this reads
// the shared stylesheet straight off disk and asserts the budget table
// reflows to a single-column stack at the Mobile tier cutoff.
const here = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(here, "../App.css"), "utf-8");

function blockFor(query: string, css: string): string {
  const start = css.indexOf(query);
  expect(start, `expected to find "${query}"`).toBeGreaterThan(-1);
  // Find the matching closing brace for this media block by counting depth.
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

describe("Budget screen responsive reflow", () => {
  it("stacks the budget table into a single column at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    expect(appCss).toContain(mobileQuery);

    const block = blockFor(mobileQuery + " {\n  .budget-table", appCss);
    expect(block).toMatch(/\.budget-table\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
    expect(block).toMatch(/\.budget-row\s*{[^}]*flex-direction:\s*column;/);
  });

  it("wraps the month-picker header instead of squeezing it at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    const block = blockFor(mobileQuery + " {\n  .budget-header", appCss);
    expect(block).toMatch(/\.budget-header\s*{[^}]*flex-wrap:\s*wrap;/);
  });

  it("tightens row density at the Compact tier without restructuring the grid", () => {
    const compactQuery = `@media (min-width: ${BREAKPOINTS.compactMin}px) and (max-width: ${BREAKPOINTS.expandedMin - 1}px)`;
    expect(appCss).toContain(compactQuery);
  });
});

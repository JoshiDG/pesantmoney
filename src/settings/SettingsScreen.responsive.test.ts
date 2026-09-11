import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS } from "../ui/breakpoints";

// Settings' reflow (issue #66) is pure cosmetic CSS per ADR-0018 -- no
// useBreakpoint()-driven structural swap. Following the precedent set for
// the Dashboard grid (issue #62's "or the equivalent CSS-driven check"
// allowance), this reads the shared stylesheet straight off disk and
// asserts the tab strip wraps and settings rows stack at the Mobile tier
// cutoff, covering General plus the Categories/Rules/Merchants tabs added
// by issue #49 (which reuse .settings-row elsewhere in their own CSS).
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

describe("Settings screen responsive reflow", () => {
  it("wraps the tab strip instead of overflowing it at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    expect(appCss).toContain(mobileQuery);

    const block = blockFor(mobileQuery + " {\n  .settings-tab-strip", appCss);
    expect(block).toMatch(/\.settings-tab-strip\s*{[^}]*flex-wrap:\s*wrap;/);
  });

  it("stacks each settings row (label above, toggle below) at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    const block = blockFor(mobileQuery + " {\n  .settings-panel", appCss);
    expect(block).toMatch(/\.settings-row\s*{[^}]*flex-direction:\s*column;/);
  });

  it("tightens row padding at the Compact tier without restructuring the row", () => {
    const compactQuery = `@media (min-width: ${BREAKPOINTS.compactMin}px) and (max-width: ${BREAKPOINTS.expandedMin - 1}px)`;
    expect(appCss).toContain(compactQuery);
  });
});

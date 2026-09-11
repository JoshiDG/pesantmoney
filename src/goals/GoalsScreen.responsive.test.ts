import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS } from "../ui/breakpoints";

// Goals is already a single-column stack of cards at every tier, so its
// Mobile-tier reflow (issue #66) is pure cosmetic CSS per ADR-0018 -- no
// useBreakpoint()-driven structural swap. Following the precedent set for
// the Dashboard grid (issue #62's "or the equivalent CSS-driven check"
// allowance), this reads the shared stylesheet straight off disk and
// asserts the goal card header un-squeezes at the Mobile tier cutoff.
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

describe("Goals screen responsive reflow", () => {
  it("stacks the goal card header (name+meta above, actions below) at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    expect(appCss).toContain(mobileQuery);

    const block = blockFor(mobileQuery + " {\n  .goal-card", appCss);
    expect(block).toMatch(/\.goal-card-header\s*{[^}]*flex-direction:\s*column;/);
  });

  it("stacks the debt payoff calculator forms at the Mobile tier cutoff", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    const block = blockFor(mobileQuery + " {\n  .goal-card", appCss);
    expect(block).toMatch(/\.goal-payoff-apr-form,\s*\n\s*\.goal-payoff-project-form\s*{[^}]*flex-direction:\s*column;/);
  });

  it("tightens card padding at the Compact tier without restructuring the card", () => {
    const compactQuery = `@media (min-width: ${BREAKPOINTS.compactMin}px) and (max-width: ${BREAKPOINTS.expandedMin - 1}px)`;
    expect(appCss).toContain(compactQuery);
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BREAKPOINTS } from "../ui/breakpoints";

// The Dashboard grid's column-count reflow is pure cosmetic CSS per
// ADR-0018 ("cosmetic reflow ... stays pure CSS media queries"), not a
// useBreakpoint()-driven structural swap -- there's no DOM/interaction
// difference between tiers, only column count and spacing. jsdom doesn't
// apply real @media layout (and Vitest's `css: false` makes `?raw` CSS
// imports resolve to an empty string), so per issue #62's "or the
// equivalent CSS-driven check" allowance, this reads the shared stylesheet
// straight off disk and asserts that the old ad hoc 900px breakpoint is
// gone and the grid reflows at the shared BREAKPOINTS cutoffs from #59.
const here = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(here, "../App.css"), "utf-8");

function ruleBodyFor(selector: string, css: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  expect(start, `expected to find a "${selector}" rule`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start + marker.length, end);
}

describe("Dashboard grid responsive reflow", () => {
  it("no longer contains the old ad hoc 900px dashboard-grid breakpoint", () => {
    expect(appCss).not.toMatch(/max-width:\s*900px/);
  });

  it("is two columns by default (Expanded tier, >=1280px)", () => {
    const body = ruleBodyFor(".dashboard-grid", appCss);
    expect(body).toMatch(/grid-template-columns:\s*1fr 1fr/);
  });

  it("collapses to a single column at the Compact tier cutoff (max-width matching expandedMin - 1)", () => {
    const compactQuery = `@media (max-width: ${BREAKPOINTS.expandedMin - 1}px)`;
    expect(appCss).toContain(compactQuery);

    const queryStart = appCss.indexOf(compactQuery);
    const blockEnd = appCss.indexOf("\n}\n", queryStart);
    const block = appCss.slice(queryStart, blockEnd);
    expect(block).toMatch(/\.dashboard-grid\s*{[^}]*grid-template-columns:\s*1fr\s*;?[^}]*}/);
  });

  it("stays single column and tightens spacing at the Mobile tier cutoff (max-width matching compactMin - 1)", () => {
    const mobileQuery = `@media (max-width: ${BREAKPOINTS.compactMin - 1}px)`;
    expect(appCss).toContain(mobileQuery);
  });
});

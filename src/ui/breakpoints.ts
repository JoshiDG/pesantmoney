// Single source of truth for the app's three Breakpoint Tiers (see ADR-0018
// and the "Breakpoint Tier" entry in CONTEXT.md). Anchored to conventional
// (Tailwind-style) cutoffs rather than one-off magic numbers per component.
//
// Expanded: >=1280px  -- nav rail shows icons + labels
// Compact:  768-1279px -- nav rail collapses to icon-only
// Mobile:   <768px     -- nav rail becomes a fixed bottom tab bar
//
// Any CSS media queries that need to line up with these tiers (per-screen
// cosmetic reflow) must use the same pixel values -- there is deliberately
// only one place these numbers are written down.
export const BREAKPOINTS = {
  compactMin: 768,
  expandedMin: 1280,
} as const;

export type BreakpointTier = "expanded" | "compact" | "mobile";

export function resolveBreakpointTier(width: number): BreakpointTier {
  if (width >= BREAKPOINTS.expandedMin) return "expanded";
  if (width >= BREAKPOINTS.compactMin) return "compact";
  return "mobile";
}

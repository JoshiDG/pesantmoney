import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { BREAKPOINTS, BreakpointTier, resolveBreakpointTier } from "./breakpoints";

// Structural swaps (which nav component mounts, table rows vs. cards) read
// this instead of ad hoc media query literals -- see ADR-0018. useBreakpoint
// resolves from real matchMedia by default; a BreakpointProvider ancestor
// can force a fixed tier for a subtree (used by the withBreakpoint test
// helper so consuming tests never need to mock matchMedia/ResizeObserver).
const BreakpointOverrideContext = createContext<BreakpointTier | null>(null);

export function BreakpointProvider({
  tier,
  children,
}: {
  tier: BreakpointTier;
  children: ReactNode;
}) {
  return (
    <BreakpointOverrideContext.Provider value={tier}>{children}</BreakpointOverrideContext.Provider>
  );
}

function currentWindowTier(): BreakpointTier {
  if (typeof window === "undefined") return "expanded";
  return resolveBreakpointTier(window.innerWidth);
}

export function useBreakpoint(): BreakpointTier {
  const override = useContext(BreakpointOverrideContext);
  const [tier, setTier] = useState<BreakpointTier>(currentWindowTier);

  useEffect(() => {
    // An override means a subtree has forced a tier for testing/tooling --
    // skip subscribing to matchMedia entirely in that case.
    if (override) return;

    const expandedQuery = window.matchMedia(`(min-width: ${BREAKPOINTS.expandedMin}px)`);
    const compactQuery = window.matchMedia(`(min-width: ${BREAKPOINTS.compactMin}px)`);

    function resolve() {
      if (expandedQuery.matches) {
        setTier("expanded");
      } else if (compactQuery.matches) {
        setTier("compact");
      } else {
        setTier("mobile");
      }
    }

    resolve();
    expandedQuery.addEventListener("change", resolve);
    compactQuery.addEventListener("change", resolve);
    return () => {
      expandedQuery.removeEventListener("change", resolve);
      compactQuery.removeEventListener("change", resolve);
    };
  }, [override]);

  return override ?? tier;
}

import { ReactNode } from "react";
import { BreakpointProvider } from "./BreakpointProvider";
import type { BreakpointTier } from "./breakpoints";

// Test-render helper for forcing a Breakpoint Tier, e.g.:
//   render(<X />, { wrapper: withBreakpoint("mobile") })
// This is the only supported way to exercise tier-dependent rendering in
// tests -- it avoids mocking matchMedia/ResizeObserver globally, since
// useBreakpoint() skips its real media-query subscription whenever a
// BreakpointProvider override is present (see BreakpointProvider.tsx).
export function withBreakpoint(tier: BreakpointTier) {
  return function BreakpointWrapper({ children }: { children: ReactNode }) {
    return <BreakpointProvider tier={tier}>{children}</BreakpointProvider>;
  };
}

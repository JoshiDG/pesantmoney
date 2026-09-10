import { describe, expect, it } from "vitest";
import { BREAKPOINTS, resolveBreakpointTier } from "./breakpoints";

describe("resolveBreakpointTier", () => {
  it("resolves widths below 768px as mobile", () => {
    expect(resolveBreakpointTier(0)).toBe("mobile");
    expect(resolveBreakpointTier(320)).toBe("mobile");
    expect(resolveBreakpointTier(767)).toBe("mobile");
  });

  it("resolves widths from 768px to 1279px as compact", () => {
    expect(resolveBreakpointTier(768)).toBe("compact");
    expect(resolveBreakpointTier(1000)).toBe("compact");
    expect(resolveBreakpointTier(1279)).toBe("compact");
  });

  it("resolves widths of 1280px and above as expanded", () => {
    expect(resolveBreakpointTier(1280)).toBe("expanded");
    expect(resolveBreakpointTier(1920)).toBe("expanded");
  });

  it("exposes the tier cutoffs as the single source of truth", () => {
    expect(BREAKPOINTS.compactMin).toBe(768);
    expect(BREAKPOINTS.expandedMin).toBe(1280);
  });
});

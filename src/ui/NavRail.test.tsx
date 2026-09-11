import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./NavRail";
import { withBreakpoint } from "./withBreakpoint";

const ALL_LABELS = ["Dashboard", "Accounts", "Transactions", "Reports", "Budget", "Goals", "Settings"];

function noopProps(overrides: Partial<Record<string, () => void>> = {}) {
  return {
    onOpenDashboard: () => {},
    onOpenAccounts: () => {},
    onOpenTransactions: () => {},
    onOpenReports: () => {},
    onOpenBudget: () => {},
    onOpenGoals: () => {},
    onOpenSettings: () => {},
    ...overrides,
  };
}

describe("NavRail", () => {
  it("renders the expected top-level nav items and no inline account rows", () => {
    render(<NavRail active="dashboard" {...noopProps()} />, { wrapper: withBreakpoint("expanded") });

    for (const label of ALL_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }

    // No inline Account list mixed into the rail anymore.
    expect(screen.queryByText(/checking|savings|credit card/i)).not.toBeInTheDocument();
  });

  it("marks the active nav item", () => {
    render(<NavRail active="accounts" {...noopProps()} />, { wrapper: withBreakpoint("expanded") });

    expect(screen.getByRole("button", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("clicking a nav item invokes its handler", async () => {
    const onOpenBudget = vi.fn();
    render(<NavRail active="dashboard" {...noopProps({ onOpenBudget })} />, {
      wrapper: withBreakpoint("expanded"),
    });

    await userEvent.click(screen.getByRole("button", { name: "Budget" }));

    expect(onOpenBudget).toHaveBeenCalledTimes(1);
  });

  it("clicking Transactions invokes its handler", async () => {
    const onOpenTransactions = vi.fn();
    render(<NavRail active="dashboard" {...noopProps({ onOpenTransactions })} />, {
      wrapper: withBreakpoint("expanded"),
    });

    await userEvent.click(screen.getByRole("button", { name: "Transactions" }));

    expect(onOpenTransactions).toHaveBeenCalledTimes(1);
  });

  it("shows icon + visible label for every destination at the Expanded tier", () => {
    render(<NavRail active="dashboard" {...noopProps()} />, { wrapper: withBreakpoint("expanded") });

    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("shows icon-only items with an accessible name and tooltip at the Compact tier", () => {
    render(<NavRail active="dashboard" {...noopProps()} />, { wrapper: withBreakpoint("compact") });

    for (const label of ALL_LABELS) {
      // No visible label text is rendered...
      expect(screen.queryByText(label)).not.toBeInTheDocument();
      // ...but the button still has an accessible name and a hover/focus tooltip.
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("title", label);
    }
  });

  it("preserves click behavior and active-item indication at the Compact tier", async () => {
    const onOpenGoals = vi.fn();
    render(<NavRail active="goals" {...noopProps({ onOpenGoals })} />, { wrapper: withBreakpoint("compact") });

    expect(screen.getByRole("button", { name: "Goals" })).toHaveAttribute("aria-current", "page");

    await userEvent.click(screen.getByRole("button", { name: "Goals" }));
    expect(onOpenGoals).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NavRail } from "./NavRail";

describe("NavRail", () => {
  it("renders the expected top-level nav items and no inline account rows", () => {
    render(
      <NavRail
        active="dashboard"
        onOpenDashboard={() => {}}
        onOpenAccounts={() => {}}
        onOpenTransactions={() => {}}
        onOpenBudget={() => {}}
        onOpenGoals={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accounts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Goals" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();

    // No inline Account list mixed into the rail anymore.
    expect(screen.queryByText(/checking|savings|credit card/i)).not.toBeInTheDocument();
  });

  it("marks the active nav item", () => {
    render(
      <NavRail
        active="accounts"
        onOpenDashboard={() => {}}
        onOpenAccounts={() => {}}
        onOpenTransactions={() => {}}
        onOpenBudget={() => {}}
        onOpenGoals={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Accounts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("clicking a nav item invokes its handler", async () => {
    const onOpenBudget = vi.fn();
    render(
      <NavRail
        active="dashboard"
        onOpenDashboard={() => {}}
        onOpenAccounts={() => {}}
        onOpenTransactions={() => {}}
        onOpenBudget={onOpenBudget}
        onOpenGoals={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Budget" }));

    expect(onOpenBudget).toHaveBeenCalledTimes(1);
  });

  it("clicking Transactions invokes its handler", async () => {
    const onOpenTransactions = vi.fn();
    render(
      <NavRail
        active="dashboard"
        onOpenDashboard={() => {}}
        onOpenAccounts={() => {}}
        onOpenTransactions={onOpenTransactions}
        onOpenBudget={() => {}}
        onOpenGoals={() => {}}
        onOpenSettings={() => {}}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Transactions" }));

    expect(onOpenTransactions).toHaveBeenCalledTimes(1);
  });
});

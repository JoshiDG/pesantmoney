import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { DashboardScreen } from "./DashboardScreen";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function account(id: number, name: string, account_type: Account["account_type"] = "checking"): Account {
  return { id, name, account_type, institution_name: null };
}

function mockInvokeWithAccountBalances(balances: [Account, number][]) {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_net_worth":
        return balances.reduce((sum, [, balance]) => sum + balance, 0);
      case "get_net_worth_by_account":
        return balances;
      case "get_cash_flow_for_range":
        return [0, 0];
      default:
        return null;
    }
  });
}

describe("DashboardScreen accounts disclosure", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("shows all accounts with no disclosure control when there are 4 or fewer", async () => {
    mockInvokeWithAccountBalances([
      [account(1, "First Checking"), 10000],
      [account(2, "Main Savings"), 5000],
      [account(3, "Wallet Cash"), 100],
      [account(4, "Brokerage", "investment"), 2000],
    ]);

    render(<DashboardScreen />);

    await screen.findByText("First Checking");
    expect(screen.getByText("Main Savings")).toBeInTheDocument();
    expect(screen.getByText("Wallet Cash")).toBeInTheDocument();
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /see all|show fewer/i })).not.toBeInTheDocument();
  });

  it("truncates to the first 4 accounts (in sort order) and reveals the rest on toggle", async () => {
    mockInvokeWithAccountBalances([
      [account(1, "First Checking"), 10000],
      [account(2, "Main Savings"), 5000],
      [account(3, "Wallet Cash"), 100],
      [account(4, "Brokerage", "investment"), 2000],
      [account(5, "Car Loan", "loan"), -500],
    ]);

    render(<DashboardScreen />);

    await screen.findByText("First Checking");
    expect(screen.getByText("Main Savings")).toBeInTheDocument();
    expect(screen.getByText("Wallet Cash")).toBeInTheDocument();
    expect(screen.getByText("Brokerage")).toBeInTheDocument();
    expect(screen.queryByText("Car Loan")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "See all 5 accounts" });
    await userEvent.click(toggle);

    expect(screen.getByText("Car Loan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));

    expect(screen.queryByText("Car Loan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See all 5 accounts" })).toBeInTheDocument();
  });

  it("shows the empty state unchanged when there are no accounts", async () => {
    mockInvokeWithAccountBalances([]);

    render(<DashboardScreen />);

    expect(await screen.findByText("No accounts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /see all|show fewer/i })).not.toBeInTheDocument();
  });
});

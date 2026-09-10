import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { currentMonth } from "../budget/types";
import { DashboardScreen } from "./DashboardScreen";
import { monthStartDate } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function account(id: number, name: string, account_type: Account["account_type"] = "checking"): Account {
  return { id, name, account_type, institution_name: null, apr_bps: null };
}

/** Scopes queries to the Net Worth widget's account breakdown, since account
 * names also appear as `<option>` text in the Recent Transactions widget's
 * account filter, which would otherwise make plain `screen.getByText`
 * ambiguous. */
function breakdown() {
  return within(document.querySelector(".net-worth-breakdown") as HTMLElement);
}

function mockInvokeWithAccountBalances(balances: [Account, number][]) {
  mockedInvoke.mockReset();
  mockedInvoke.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case "get_net_worth":
        return balances.reduce((sum, [, balance]) => sum + balance, 0);
      case "get_net_worth_by_account":
        return balances;
      case "get_net_worth_as_of":
        return balances.reduce((sum, [, balance]) => sum + balance, 0);
      case "get_daily_cash_flow_for_range":
        return [];
      case "get_ready_to_assign":
        return 0;
      case "get_budget_for_month":
        return [];
      case "list_accounts":
        return balances.map(([a]) => a);
      case "list_categories":
        return [];
      case "list_transactions":
        return [];
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

    await breakdown().findByText("First Checking");
    expect(breakdown().getByText("Main Savings")).toBeInTheDocument();
    expect(breakdown().getByText("Wallet Cash")).toBeInTheDocument();
    expect(breakdown().getByText("Brokerage")).toBeInTheDocument();
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

    await breakdown().findByText("First Checking");
    expect(breakdown().getByText("Main Savings")).toBeInTheDocument();
    expect(breakdown().getByText("Wallet Cash")).toBeInTheDocument();
    expect(breakdown().getByText("Brokerage")).toBeInTheDocument();
    expect(breakdown().queryByText("Car Loan")).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "See all 5 accounts" });
    await userEvent.click(toggle);

    expect(breakdown().getByText("Car Loan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));

    expect(breakdown().queryByText("Car Loan")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See all 5 accounts" })).toBeInTheDocument();
  });

  it("shows the empty state unchanged when there are no accounts", async () => {
    mockInvokeWithAccountBalances([]);

    render(<DashboardScreen />);

    expect(await screen.findByText("No accounts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /see all|show fewer/i })).not.toBeInTheDocument();
  });
});

describe("DashboardScreen net worth widget", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("renders the net worth hero figure from get_net_worth", async () => {
    mockInvokeWithAccountBalances([
      [account(1, "First Checking"), 42_500],
      [account(2, "Rewards Card", "credit_card"), -2_500],
    ]);

    render(<DashboardScreen />);

    await breakdown().findByText("First Checking");
    expect(screen.getByText("$400.00")).toBeInTheDocument();
  });
});

describe("DashboardScreen budget widget", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("shows Ready to Assign and a per-group Assigned/Activity/Available rollup", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_net_worth":
        case "get_net_worth_as_of":
          return 0;
        case "get_net_worth_by_account":
          return [];
        case "get_daily_cash_flow_for_range":
          return [];
        case "get_ready_to_assign":
          return 15_000;
        case "get_budget_for_month":
          return [
            {
              category_id: 1,
              category_name: "Groceries",
              group_id: 1,
              group_name: "Food",
              assigned_cents: 40_000,
              activity_cents: -12_000,
              available_cents: 28_000,
            },
            {
              category_id: 2,
              category_name: "Restaurants",
              group_id: 1,
              group_name: "Food",
              assigned_cents: 10_000,
              activity_cents: -5_000,
              available_cents: 5_000,
            },
          ];
        default:
          return null;
      }
    });

    render(<DashboardScreen />);

    expect(await screen.findByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(screen.getByText("-$170.00")).toBeInTheDocument();
    expect(screen.getByText("$330.00")).toBeInTheDocument();
  });
});

describe("DashboardScreen spending widget", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("renders spent-so-far and average-pace figures from daily cash flow data", async () => {
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      switch (cmd) {
        case "get_net_worth":
        case "get_net_worth_as_of":
          return 0;
        case "get_net_worth_by_account":
          return [];
        case "get_ready_to_assign":
          return 0;
        case "get_budget_for_month":
          return [];
        case "list_accounts":
          return [];
        case "list_categories":
          return [];
        case "list_transactions":
          return [];
        case "get_daily_cash_flow_for_range": {
          const startDate = String((args as { start_date?: string } | undefined)?.start_date ?? "");
          // The current month's range gets a real day-1 expense; every
          // trailing comparison month gets none, so "spent so far" should
          // read as spending faster than the (zero) average.
          const isCurrentMonth = startDate === monthStartDate(currentMonth());
          return isCurrentMonth ? [[startDate, 0, 2_000]] : [[startDate, 0, 0]];
        }
        default:
          return null;
      }
    });

    render(<DashboardScreen />);

    await screen.findByText("Spent so far this month");
    expect(screen.getByText("Average pace")).toBeInTheDocument();
    expect(screen.getByText("$20.00")).toBeInTheDocument();
  });
});

describe("DashboardScreen recent transactions widget", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("merges each account's transactions, sorts by date descending, and caps at 5", async () => {
    const checking = account(1, "Everyday Checking");
    const savings = account(2, "Rainy Day Fund", "savings");

    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      switch (cmd) {
        case "get_net_worth":
        case "get_net_worth_as_of":
          return 0;
        case "get_net_worth_by_account":
          return [];
        case "get_ready_to_assign":
          return 0;
        case "get_budget_for_month":
          return [];
        case "get_daily_cash_flow_for_range":
          return [];
        case "list_accounts":
          return [checking, savings];
        case "list_categories":
          return [{ id: 1, group_id: 1, name: "Groceries" }];
        case "list_transactions": {
          const accountId = (args as { account_id?: number } | undefined)?.account_id;
          if (accountId === checking.id) {
            return [
              {
                id: 1,
                account_id: checking.id,
                date: "2026-09-01",
                amount_cents: -1_200,
                description: "SQ *BLUE BOTTLE",
                merchant_name: "Blue Bottle Coffee",
                category_id: 1,
                hidden: false,
              },
              {
                id: 2,
                account_id: checking.id,
                date: "2026-09-05",
                amount_cents: 100_000,
                description: "Paycheck",
                merchant_name: null,
                category_id: null,
                hidden: false,
              },
              {
                id: 3,
                account_id: checking.id,
                date: "2026-09-06",
                amount_cents: -50_00,
                description: "Hidden expense",
                merchant_name: null,
                category_id: null,
                hidden: true,
              },
            ];
          }
          if (accountId === savings.id) {
            return [
              {
                id: 4,
                account_id: savings.id,
                date: "2026-09-03",
                amount_cents: 25_000,
                description: "Transfer in",
                merchant_name: null,
                category_id: null,
                hidden: false,
              },
            ];
          }
          return [];
        }
        default:
          return null;
      }
    });

    render(<DashboardScreen />);

    await screen.findByText("Paycheck");
    expect(screen.getByText("Blue Bottle Coffee")).toBeInTheDocument();
    expect(screen.getByText("Transfer in")).toBeInTheDocument();
    // The hidden transaction is excluded even though its date is newest.
    expect(screen.queryByText("Hidden expense")).not.toBeInTheDocument();

    const rows = screen.getAllByText(/Paycheck|Blue Bottle Coffee|Transfer in/);
    // Most recent first: Paycheck (09-05) before Transfer in (09-03) before
    // Blue Bottle Coffee (09-01).
    expect(rows.map((el) => el.textContent)).toEqual(["Paycheck", "Transfer in", "Blue Bottle Coffee"]);
  });
});

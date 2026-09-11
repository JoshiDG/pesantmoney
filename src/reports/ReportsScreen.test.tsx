import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { currentMonth } from "../budget/types";
import { ReportsScreen } from "./ReportsScreen";
import { MonthlyCashFlow } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

function monthlyCashFlow(
  month: string,
  income_cents: number,
  expense_cents: number,
): MonthlyCashFlow {
  return { month, income_cents, expense_cents, net_cents: income_cents - expense_cents };
}

/** Scopes queries to the Cash Flow tab's income/expense/net summary, since
 * "Income"/"Expenses" also appear as tab and chart-legend labels, which
 * would otherwise make plain `screen.getByText` ambiguous. */
function cashFlowSummary() {
  return within(document.querySelector(".cash-flow-summary") as HTMLElement);
}

describe("ReportsScreen tab strip", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [];
        default:
          return null;
      }
    });
  });

  it("renders Cash Flow, Spending, and Income tabs with Cash Flow active by default", async () => {
    render(<ReportsScreen />);

    const cashFlowTab = await screen.findByRole("tab", { name: "Cash Flow" });
    expect(cashFlowTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Spending" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Income" })).toHaveAttribute("aria-selected", "false");
  });

  it("switches tabs on click, showing stubbed content for Spending and Income", async () => {
    render(<ReportsScreen />);

    await screen.findByRole("tab", { name: "Cash Flow" });

    await userEvent.click(screen.getByRole("tab", { name: "Spending" }));
    expect(screen.getByRole("tab", { name: "Spending" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Spending by Category is coming soon.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByRole("tab", { name: "Income" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Income by Category is coming soon.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    expect(screen.getByRole("tab", { name: "Cash Flow" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("ReportsScreen Cash Flow tab", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("shows income/expense/net totals trended from mocked monthly data", async () => {
    const month = currentMonth();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [monthlyCashFlow(month, 5_000_00, 2_000_00)];
        default:
          return null;
      }
    });

    render(<ReportsScreen />);

    await screen.findByText("$5,000.00");
    expect(cashFlowSummary().getByText("Expenses")).toBeInTheDocument();
    expect(cashFlowSummary().getByText("-$2,000.00")).toBeInTheDocument();
    expect(cashFlowSummary().getByText("Net")).toBeInTheDocument();
    expect(cashFlowSummary().getByText("$3,000.00")).toBeInTheDocument();
  });

  it("lets the user change the date range, re-fetching and re-aggregating totals", async () => {
    const month = currentMonth();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range": {
          const startMonth = (args as { start_month?: string } | undefined)?.start_month;
          if (startMonth === month) {
            // "This month" (range = 1): single month of data.
            return [monthlyCashFlow(month, 1_000_00, 400_00)];
          }
          // Wider ranges (the default range = 3): two months of data.
          return [monthlyCashFlow(month, 1_000_00, 400_00), monthlyCashFlow(month, 2_000_00, 600_00)];
        }
        default:
          return null;
      }
    });

    render(<ReportsScreen />);

    // Default range is "Last 3 months" -- totals across both mocked months.
    await screen.findByText("$3,000.00");
    expect(screen.getByText("-$1,000.00")).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Cash flow date range" }),
      "1",
    );

    expect(await screen.findByText("$1,000.00")).toBeInTheDocument();
    expect(screen.getByText("-$400.00")).toBeInTheDocument();
  });

  it("shows a well-defined zero state for an empty range with no data", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [monthlyCashFlow(currentMonth(), 0, 0)];
        default:
          return null;
      }
    });

    render(<ReportsScreen />);

    const zeroAmounts = await screen.findAllByText("$0.00");
    expect(zeroAmounts.length).toBeGreaterThan(0);
  });
});

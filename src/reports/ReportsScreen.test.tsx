import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { currentMonth } from "../budget/types";
import { withBreakpoint } from "../ui/withBreakpoint";
import { ReportsScreen } from "./ReportsScreen";
import { CategoryIncome, CategorySpending, MonthlyCashFlow } from "./types";

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

function categorySpending(
  category_id: number | null,
  category_name: string,
  amount_cents: number,
): CategorySpending {
  return { category_id, category_name, amount_cents };
}

function categoryIncome(category_name: string, income_cents: number): CategoryIncome {
  return { category_name, income_cents };
}

/** Scopes queries to the Income tab's category breakdown list, since
 * category names could otherwise collide with unrelated text elsewhere on
 * the screen. */
function incomeCategoryList() {
  return within(document.querySelector(".income-category-list") as HTMLElement);
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
        case "get_spending_by_category_for_range":
          return [];
        case "get_income_by_category_for_range":
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

  it("switches tabs on click, showing the Spending breakdown and Income breakdown", async () => {
    render(<ReportsScreen />);

    await screen.findByRole("tab", { name: "Cash Flow" });

    await userEvent.click(screen.getByRole("tab", { name: "Spending" }));
    expect(screen.getByRole("tab", { name: "Spending" })).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByText("No spending in the selected range."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByRole("tab", { name: "Income" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Total Income")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Cash Flow" }));
    expect(screen.getByRole("tab", { name: "Cash Flow" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("ReportsScreen Income tab", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("renders the per-Category income breakdown from mocked data", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [];
        case "get_income_by_category_for_range":
          return [categoryIncome("Paycheck", 5_000_00), categoryIncome("Interest", 1_000_00)];
        default:
          return null;
      }
    });

    render(<ReportsScreen />);

    await userEvent.click(await screen.findByRole("tab", { name: "Income" }));

    expect(await screen.findByText("$6,000.00")).toBeInTheDocument();
    expect(incomeCategoryList().getByText("Paycheck")).toBeInTheDocument();
    expect(incomeCategoryList().getByText("$5,000.00")).toBeInTheDocument();
    expect(incomeCategoryList().getByText("Interest")).toBeInTheDocument();
    expect(incomeCategoryList().getByText("$1,000.00")).toBeInTheDocument();
  });

  it("renders a Category-less Transaction's total under the Uncategorized bucket", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [];
        case "get_income_by_category_for_range":
          return [categoryIncome("Paycheck", 5_000_00), categoryIncome("Uncategorized", 1_500_00)];
        default:
          return null;
      }
    });

    render(<ReportsScreen />);

    await userEvent.click(await screen.findByRole("tab", { name: "Income" }));

    await screen.findByText("Paycheck");
    expect(incomeCategoryList().getByText("Uncategorized")).toBeInTheDocument();
    expect(incomeCategoryList().getByText("$1,500.00")).toBeInTheDocument();
  });

  it("shows an empty state when there is no income in the selected range", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [];
        case "get_income_by_category_for_range":
          return [];
        default:
          return null;
      }
    });

    render(<ReportsScreen />);

    await userEvent.click(await screen.findByRole("tab", { name: "Income" }));

    expect(await screen.findByText("No income in this range yet.")).toBeInTheDocument();
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

describe("ReportsScreen Spending tab", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  async function openSpendingTab() {
    render(<ReportsScreen />);
    await userEvent.click(await screen.findByRole("tab", { name: "Spending" }));
  }

  it("renders per-Category expense totals from mocked data, including an Uncategorized bucket", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_spending_by_category_for_range":
          return [
            categorySpending(1, "Groceries", 5_000_00),
            categorySpending(null, "Uncategorized", 1_500_00),
          ];
        case "get_monthly_cash_flow_for_range":
          return [];
        default:
          return null;
      }
    });

    await openSpendingTab();

    expect(await screen.findByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("-$5,000.00")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByText("-$1,500.00")).toBeInTheDocument();
    expect(screen.getByText("-$6,500.00")).toBeInTheDocument();
  });

  it("respects the date-range control, re-fetching and re-rendering totals", async () => {
    const month = currentMonth();
    mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
      switch (cmd) {
        case "get_spending_by_category_for_range": {
          const startMonth = (args as { start_month?: string } | undefined)?.start_month;
          if (startMonth === month) {
            // "This month" (range = 1).
            return [categorySpending(1, "Groceries", 1_000_00)];
          }
          // Wider ranges (the default range = 3).
          return [categorySpending(1, "Groceries", 4_000_00)];
        }
        case "get_monthly_cash_flow_for_range":
          return [];
        default:
          return null;
      }
    });

    await openSpendingTab();

    expect((await screen.findAllByText("-$4,000.00")).length).toBeGreaterThan(0);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Spending date range" }),
      "1",
    );

    expect((await screen.findAllByText("-$1,000.00")).length).toBeGreaterThan(0);
  });

  it("shows a well-defined empty state for a range with no spending", async () => {
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_spending_by_category_for_range":
          return [];
        case "get_monthly_cash_flow_for_range":
          return [];
        default:
          return null;
      }
    });

    await openSpendingTab();

    expect(await screen.findByText("No spending in the selected range.")).toBeInTheDocument();
  });
});

describe("ReportsScreen at the Mobile tier", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (cmd: string) => {
      switch (cmd) {
        case "get_monthly_cash_flow_for_range":
          return [monthlyCashFlow(currentMonth(), 5_000_00, 2_000_00)];
        case "get_spending_by_category_for_range":
          return [categorySpending(1, "Groceries", 3_000_00)];
        case "get_income_by_category_for_range":
          return [categoryIncome("Paycheck", 5_000_00)];
        default:
          return null;
      }
    });
  });

  // Reports is chart/summary-based, not a dense row grid, so per ADR-0018 it
  // gets cosmetic CSS reflow at Mobile tier (asserted separately in
  // ReportsScreen.responsive.test.ts) rather than a useBreakpoint()-driven
  // structural swap. This just confirms tab switching and every tab's
  // content still render and stay usable when forced to the Mobile tier.
  it("still switches tabs and shows each tab's content at the Mobile tier", async () => {
    render(<ReportsScreen />, { wrapper: withBreakpoint("mobile") });

    const cashFlowTab = await screen.findByRole("tab", { name: "Cash Flow" });
    expect(cashFlowTab).toHaveAttribute("aria-selected", "true");
    expect(cashFlowSummary().getByText("Income")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Spending" }));
    expect(await screen.findByText("Groceries")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Income" }));
    expect(incomeCategoryList().getByText("Paycheck")).toBeInTheDocument();
  });
});

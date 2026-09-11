/** One month's cross-Account income/expense/net cash flow, as returned by
 * `get_monthly_cash_flow_for_range` (see `services::reports::MonthlyCashFlow`
 * on the Rust side). `month` is "YYYY-MM". */
export interface MonthlyCashFlow {
  month: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
}

/** Range options for the Cash Flow tab's date-range control: how many
 * trailing calendar months (including the current one) to trend over. */
export type CashFlowRange = 1 | 3 | 6 | 12;

export const CASH_FLOW_RANGE_LABELS: Record<CashFlowRange, string> = {
  1: "This month",
  3: "Last 3 months",
  6: "Last 6 months",
  12: "Last 12 months",
};

export const CASH_FLOW_RANGE_OPTIONS: CashFlowRange[] = [1, 3, 6, 12];

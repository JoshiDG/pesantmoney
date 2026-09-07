import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { currentMonth, formatMonth } from "../budget/types";
import { formatCents } from "../transactions/types";
import {
  AccountBalance,
  CashFlow,
  formatMonthShort,
  isAssetType,
  lastMonths,
  monthEndDate,
  monthStartDate,
  sortForBreakdown,
} from "./types";

interface MonthlyCashFlow {
  month: string;
  income: number;
  expense: number;
}

const TREND_MONTHS = 6;

export function DashboardScreen() {
  const [netWorthCents, setNetWorthCents] = useState(0);
  const [breakdown, setBreakdown] = useState<AccountBalance[]>([]);
  const [thisMonth, setThisMonth] = useState<CashFlow>([0, 0]);
  const [trend, setTrend] = useState<MonthlyCashFlow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const month = currentMonth();
      const months = lastMonths(TREND_MONTHS);

      const [netWorth, accountBalances, monthCashFlow, trendCashFlows] = await Promise.all([
        invoke<number>("get_net_worth"),
        invoke<AccountBalance[]>("get_net_worth_by_account"),
        invoke<CashFlow>("get_cash_flow_for_range", {
          account_id: null,
          start_date: monthStartDate(month),
          end_date: monthEndDate(month),
        }),
        Promise.all(
          months.map((m) =>
            invoke<CashFlow>("get_cash_flow_for_range", {
              account_id: null,
              start_date: monthStartDate(m),
              end_date: monthEndDate(m),
            }),
          ),
        ),
      ]);

      setNetWorthCents(netWorth);
      setBreakdown(sortForBreakdown(accountBalances));
      setThisMonth(monthCashFlow);
      setTrend(
        months.map((m, i) => ({
          month: m,
          income: trendCashFlows[i][0],
          expense: trendCashFlows[i][1],
        })),
      );
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const [incomeCents, expenseCents] = thisMonth;
  const netCents = incomeCents - expenseCents;

  const maxTrendMagnitude = Math.max(
    1,
    ...trend.map((m) => Math.max(m.income, m.expense)),
  );

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Dashboard</h2>
          <div className="account-title-meta">Net worth and cash flow across every account</div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="net-worth-hero">
        <span className="net-worth-label">Net worth</span>
        <span className={`net-worth-amount ${netWorthCents < 0 ? "debit" : "credit"}`}>
          {formatCents(netWorthCents)}
        </span>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Accounts</h3>
        <div className="net-worth-breakdown">
          {breakdown.map(([account, balance]) => (
            <div key={account.id} className="net-worth-row">
              <div>
                <div className="net-worth-row-name">{account.name}</div>
                <div className="net-worth-row-meta">
                  {ACCOUNT_TYPE_LABELS[account.account_type]}
                  {isAssetType(account.account_type) ? "" : " · liability"}
                </div>
              </div>
              <span className={`amount ${balance < 0 ? "debit" : "credit"}`}>{formatCents(balance)}</span>
            </div>
          ))}
          {breakdown.length === 0 && <p className="empty-state">No accounts yet.</p>}
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">This month · {formatMonth(currentMonth())}</h3>
        <div className="cash-flow-summary">
          <div className="cash-flow-stat">
            <span className="cash-flow-stat-label">Income</span>
            <span className="amount credit">{formatCents(incomeCents)}</span>
          </div>
          <div className="cash-flow-stat">
            <span className="cash-flow-stat-label">Expenses</span>
            <span className="amount debit">{formatCents(expenseCents)}</span>
          </div>
          <div className="cash-flow-stat">
            <span className="cash-flow-stat-label">Net</span>
            <span className={`amount ${netCents < 0 ? "debit" : "credit"}`}>{formatCents(netCents)}</span>
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="dashboard-section-title">Last {TREND_MONTHS} months</h3>
        <div className="trend-chart">
          {trend.map((m) => (
            <div key={m.month} className="trend-chart-month">
              <div className="trend-chart-bars">
                <div
                  className="trend-chart-bar trend-chart-bar-income"
                  style={{ height: `${(m.income / maxTrendMagnitude) * 100}%` }}
                  title={`Income: ${formatCents(m.income)}`}
                />
                <div
                  className="trend-chart-bar trend-chart-bar-expense"
                  style={{ height: `${(m.expense / maxTrendMagnitude) * 100}%` }}
                  title={`Expenses: ${formatCents(m.expense)}`}
                />
              </div>
              <span className="trend-chart-label">{formatMonthShort(m.month)}</span>
            </div>
          ))}
        </div>
        <div className="trend-chart-legend">
          <span><span className="trend-chart-swatch trend-chart-swatch-income" /> Income</span>
          <span><span className="trend-chart-swatch trend-chart-swatch-expense" /> Expenses</span>
        </div>
      </div>
    </section>
  );
}

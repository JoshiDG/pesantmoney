import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { addMonths, currentMonth } from "../budget/types";
import { formatCents } from "../transactions/types";
import { monthEndDate, monthStartDate, svgPolylinePoints } from "./types";

type SpendingAveragePeriod = "3m" | "6m" | "12m";

const PERIOD_LABELS: Record<SpendingAveragePeriod, string> = {
  "3m": "vs 3-month average",
  "6m": "vs 6-month average",
  "12m": "vs 12-month average",
};

const PERIOD_MONTHS: Record<SpendingAveragePeriod, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

/** `(date, income_cents, expense_cents)` as returned by `get_daily_cash_flow_for_range`. */
type DailyCashFlow = [string, number, number];

function daysInMonth(month: string): number {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon, 0).getDate();
}

function cumulativeSum(values: number[]): number[] {
  const result: number[] = [];
  let running = 0;
  for (const value of values) {
    running += value;
    result.push(running);
  }
  return result;
}

export function SpendingWidget() {
  const [thisMonthCumulative, setThisMonthCumulative] = useState<number[]>([]);
  const [averageCumulative, setAverageCumulative] = useState<number[]>([]);
  const [period, setPeriod] = useState<SpendingAveragePeriod>("3m");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const month = currentMonth();
        const dayCount = daysInMonth(month);

        const monthCount = PERIOD_MONTHS[period];
        const priorMonths = Array.from({ length: monthCount }, (_, i) => addMonths(month, -(i + 1)));

        const [thisMonthDays, priorMonthDays] = await Promise.all([
          invoke<DailyCashFlow[]>("get_daily_cash_flow_for_range", {
            account_id: null,
            start_date: monthStartDate(month),
            end_date: monthEndDate(month),
          }),
          Promise.all(
            priorMonths.map((m) =>
              invoke<DailyCashFlow[]>("get_daily_cash_flow_for_range", {
                account_id: null,
                start_date: monthStartDate(m),
                end_date: monthEndDate(m),
              }),
            ),
          ),
        ]);

        if (cancelled) return;

        const thisMonthExpenseByDay = thisMonthDays.map(([, , expense]) => expense);

        const averageExpenseByDay: number[] = [];
        for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
          const valuesAtDay = priorMonthDays
            .map((days) => days[dayIndex])
            .filter((day): day is DailyCashFlow => day !== undefined)
            .map(([, , expense]) => expense);
          const average =
            valuesAtDay.length > 0 ? valuesAtDay.reduce((a, b) => a + b, 0) / valuesAtDay.length : 0;
          averageExpenseByDay.push(average);
        }

        setThisMonthCumulative(cumulativeSum(thisMonthExpenseByDay));
        setAverageCumulative(cumulativeSum(averageExpenseByDay));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const todayDayOfMonth = new Date().getDate();
  const compareIndex = Math.min(todayDayOfMonth, thisMonthCumulative.length) - 1;
  const spentSoFarCents = thisMonthCumulative[compareIndex] ?? 0;
  const averageSoFarCents = averageCumulative[compareIndex] ?? 0;
  const spendingFasterThanAverage = spentSoFarCents > averageSoFarCents;

  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Spending</h3>
        <select
          className="dashboard-widget-period"
          aria-label="Spending comparison period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as SpendingAveragePeriod)}
        >
          {(Object.keys(PERIOD_LABELS) as SpendingAveragePeriod[]).map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="cash-flow-summary">
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Spent so far this month</span>
          <span className={`amount ${spendingFasterThanAverage ? "debit" : "credit"}`}>
            {formatCents(spentSoFarCents)}
          </span>
        </div>
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Average pace</span>
          <span className="amount">{formatCents(averageSoFarCents)}</span>
        </div>
      </div>

      <SpendingChart thisMonth={thisMonthCumulative} average={averageCumulative} />

      <div className="spending-chart-legend">
        <span>
          <span className="spending-chart-swatch spending-chart-swatch-this-month" /> This month
        </span>
        <span>
          <span className="spending-chart-swatch spending-chart-swatch-average" /> Average month
        </span>
      </div>
    </div>
  );
}

function SpendingChart({ thisMonth, average }: { thisMonth: number[]; average: number[] }) {
  if (thisMonth.length < 2) {
    return null;
  }

  const width = 280;
  const height = 100;
  const max = Math.max(1, ...thisMonth, ...average);
  const toPoints = (values: number[]) => svgPolylinePoints(values, 0, max, width, height);

  return (
    <svg
      className="spending-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative spending this month vs the trailing average month"
    >
      <polyline points={toPoints(average)} fill="none" stroke="var(--text-tertiary)" strokeWidth={2} />
      <polyline points={toPoints(thisMonth)} fill="none" stroke="var(--debit)" strokeWidth={2} />
    </svg>
  );
}

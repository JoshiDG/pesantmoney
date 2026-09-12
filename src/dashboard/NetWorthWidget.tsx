import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ACCOUNT_TYPE_LABELS } from "../accounts/types";
import { formatCents } from "../transactions/types";
import { AccountBalance, isoDateNDaysAgo, isAssetType, sortForBreakdown, svgPolylinePoints } from "./types";
import { CustomSelect } from "../ui/Dropdown";

const VISIBLE_ACCOUNT_COUNT = 4;
const TREND_POINTS = 12;

type NetWorthPeriod = "3m" | "6m" | "1y";

const PERIOD_LABELS: Record<NetWorthPeriod, string> = {
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "1y": "Last 12 months",
};

const PERIOD_DAYS: Record<NetWorthPeriod, number> = {
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

interface TrendPoint {
  date: string;
  netWorthCents: number;
}

export function NetWorthWidget() {
  const [netWorthCents, setNetWorthCents] = useState(0);
  const [breakdown, setBreakdown] = useState<AccountBalance[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [period, setPeriod] = useState<NetWorthPeriod>("6m");
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const totalDays = PERIOD_DAYS[period];
        const daysAgoByPoint = Array.from({ length: TREND_POINTS }, (_, i) =>
          Math.round((totalDays * (TREND_POINTS - 1 - i)) / (TREND_POINTS - 1)),
        );

        const [netWorth, accountBalances, trendValues] = await Promise.all([
          invoke<number>("get_net_worth"),
          invoke<AccountBalance[]>("get_net_worth_by_account"),
          Promise.all(
            daysAgoByPoint.map((daysAgo) =>
              invoke<number>("get_net_worth_as_of", { date: isoDateNDaysAgo(daysAgo) }),
            ),
          ),
        ]);

        if (cancelled) return;
        setNetWorthCents(netWorth);
        setBreakdown(sortForBreakdown(accountBalances));
        setTrend(
          daysAgoByPoint.map((daysAgo, i) => ({
            date: isoDateNDaysAgo(daysAgo),
            netWorthCents: trendValues[i],
          })),
        );
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

  const hasHiddenAccounts = breakdown.length > VISIBLE_ACCOUNT_COUNT;
  const visibleBreakdown =
    hasHiddenAccounts && !showAllAccounts ? breakdown.slice(0, VISIBLE_ACCOUNT_COUNT) : breakdown;

  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Net Worth</h3>
        <CustomSelect
          className="dashboard-widget-period"
          ariaLabel="Net worth trend period"
          options={(Object.keys(PERIOD_LABELS) as NetWorthPeriod[]).map((p) => ({
            value: p,
            label: PERIOD_LABELS[p],
          }))}
          value={period}
          onChange={setPeriod}
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="net-worth-hero">
        <span className="net-worth-label">Net worth</span>
        <span className={`net-worth-amount ${netWorthCents < 0 ? "debit" : "credit"}`}>
          {formatCents(netWorthCents)}
        </span>
      </div>

      <NetWorthTrendChart trend={trend} />

      <div className="net-worth-breakdown">
        {visibleBreakdown.map(([account, balance]) => (
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
      {hasHiddenAccounts && (
        <button type="button" onClick={() => setShowAllAccounts((shown) => !shown)}>
          {showAllAccounts ? "Show fewer" : `See all ${breakdown.length} accounts`}
        </button>
      )}
    </div>
  );
}

function NetWorthTrendChart({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) {
    return null;
  }

  const width = 280;
  const height = 64;
  const values = trend.map((p) => p.netWorthCents);
  const points = svgPolylinePoints(values, Math.min(...values), Math.max(...values), width, height);

  return (
    <svg
      className="net-worth-trend-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Net worth trend"
    >
      {/* var(--ink) was the light-theme navy-on-paper line color; --ink is
          now the near-black sidebar/nav color, invisible against the equally
          dark --paper canvas. --accent-label (ADR-0020's multi-accent
          metadata color) keeps this neutral trend line legible and distinct
          from the credit/debit-coded amounts elsewhere on the widget. */}
      <polyline points={points} fill="none" stroke="var(--accent-label)" strokeWidth={2} />
    </svg>
  );
}

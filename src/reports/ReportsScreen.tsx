import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { addMonths, currentMonth } from "../budget/types";
import { monthEndDate, monthStartDate } from "../dashboard/types";
import { formatCents } from "../transactions/types";
import { CustomSelect } from "../ui/Dropdown";
import {
  CASH_FLOW_RANGE_LABELS,
  CASH_FLOW_RANGE_OPTIONS,
  CashFlowRange,
  CategoryIncome,
  CategorySpending,
  MonthlyCashFlow,
} from "./types";

type ReportsTab = "cash-flow" | "spending" | "income";

const TABS: { key: ReportsTab; label: string }[] = [
  { key: "cash-flow", label: "Cash Flow" },
  { key: "spending", label: "Spending" },
  { key: "income", label: "Income" },
];

export function ReportsScreen() {
  const [activeTab, setActiveTab] = useState<ReportsTab>("cash-flow");

  return (
    <section className="reports-screen">
      <div className="content-header">
        <div>
          <h2 className="account-title">Reports</h2>
          <div className="account-title-meta">Cash flow, spending, and income across every Account</div>
        </div>
      </div>

      <div className="tab-strip" role="tablist" aria-label="Reports">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`reports-tab-${key}`}
            aria-selected={activeTab === key}
            aria-controls={`reports-panel-${key}`}
            className={`tab-strip-item${activeTab === key ? " selected" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="reports-panel-cash-flow"
        aria-labelledby="reports-tab-cash-flow"
        hidden={activeTab !== "cash-flow"}
      >
        {activeTab === "cash-flow" && <CashFlowTab />}
      </div>
      <div
        role="tabpanel"
        id="reports-panel-spending"
        aria-labelledby="reports-tab-spending"
        hidden={activeTab !== "spending"}
      >
        {activeTab === "spending" && <SpendingTab />}
      </div>
      <div
        role="tabpanel"
        id="reports-panel-income"
        aria-labelledby="reports-tab-income"
        hidden={activeTab !== "income"}
      >
        {activeTab === "income" && <IncomeTab />}
      </div>
    </section>
  );
}

function CashFlowTab() {
  const [range, setRange] = useState<CashFlowRange>(3);
  const [months, setMonths] = useState<MonthlyCashFlow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const endMonth = currentMonth();
        const startMonth = addMonths(endMonth, -(range - 1));
        const result = await invoke<MonthlyCashFlow[]>("get_monthly_cash_flow_for_range", {
          start_month: startMonth,
          end_month: endMonth,
        });
        if (!cancelled) {
          setMonths(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const totalIncomeCents = months.reduce((sum, m) => sum + m.income_cents, 0);
  const totalExpenseCents = months.reduce((sum, m) => sum + m.expense_cents, 0);
  const totalNetCents = totalIncomeCents - totalExpenseCents;

  return (
    <div className="dashboard-widget reports-cash-flow-tab">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Cash Flow</h3>
        <CustomSelect
          className="dashboard-widget-period"
          ariaLabel="Cash flow date range"
          options={CASH_FLOW_RANGE_OPTIONS.map((r) => ({ value: r, label: CASH_FLOW_RANGE_LABELS[r] }))}
          value={range}
          onChange={(val) => setRange(Number(val) as CashFlowRange)}
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="cash-flow-summary">
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Income</span>
          <span className="amount credit">{formatCents(totalIncomeCents)}</span>
        </div>
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Expenses</span>
          <span className="amount debit">{formatCents(-totalExpenseCents)}</span>
        </div>
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Net</span>
          <span className={`amount ${totalNetCents >= 0 ? "credit" : "debit"}`}>
            {formatCents(totalNetCents)}
          </span>
        </div>
      </div>

      <CashFlowChart months={months} />

      <div className="spending-chart-legend">
        <span>
          <span className="spending-chart-swatch spending-chart-swatch-income" /> Income
        </span>
        <span>
          <span className="spending-chart-swatch spending-chart-swatch-expense" /> Expenses
        </span>
      </div>
    </div>
  );
}

function CashFlowChart({ months }: { months: MonthlyCashFlow[] }) {
  if (months.length < 2) {
    return null;
  }

  const width = 280;
  const height = 100;
  const income = months.map((m) => m.income_cents);
  const expense = months.map((m) => m.expense_cents);
  const max = Math.max(1, ...income, ...expense);

  const toPoints = (values: number[]) =>
    values
      .map((v, i) => {
        const x = (i / (months.length - 1)) * width;
        const y = height - (v / max) * height;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <svg
      className="spending-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Income and expenses trended over the selected range"
    >
      <polyline points={toPoints(expense)} fill="none" stroke="var(--debit)" strokeWidth={2} />
      <polyline points={toPoints(income)} fill="none" stroke="var(--credit)" strokeWidth={2} />
    </svg>
  );
}

function SpendingTab() {
  const [range, setRange] = useState<CashFlowRange>(3);
  const [categories, setCategories] = useState<CategorySpending[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const endMonth = currentMonth();
        const startMonth = addMonths(endMonth, -(range - 1));
        const result = await invoke<CategorySpending[]>("get_spending_by_category_for_range", {
          start_month: startMonth,
          end_month: endMonth,
        });
        if (!cancelled) {
          setCategories(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const totalCents = categories.reduce((sum, c) => sum + c.amount_cents, 0);
  const maxCents = Math.max(1, ...categories.map((c) => c.amount_cents));

  return (
    <div className="dashboard-widget reports-spending-tab">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Spending by Category</h3>
        <CustomSelect
          className="dashboard-widget-period"
          ariaLabel="Spending date range"
          options={CASH_FLOW_RANGE_OPTIONS.map((r) => ({ value: r, label: CASH_FLOW_RANGE_LABELS[r] }))}
          value={range}
          onChange={(val) => setRange(Number(val) as CashFlowRange)}
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="cash-flow-summary">
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Total Spending</span>
          <span className="amount debit">{formatCents(-totalCents)}</span>
        </div>
      </div>

      {categories.length === 0 && !error && (
        <p className="empty-state">No spending in the selected range.</p>
      )}

      <ul className="spending-category-list">
        {categories.map((category) => (
          <li
            key={category.category_id ?? "uncategorized"}
            className="spending-category-row"
          >
            <div className="spending-category-row-header">
              <span className="spending-category-name">{category.category_name}</span>
              <span className="amount debit">{formatCents(-category.amount_cents)}</span>
            </div>
            <div className="goal-progress-bar">
              <div
                className="goal-progress-fill negative"
                style={{ width: `${(category.amount_cents / maxCents) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IncomeTab() {
  const [range, setRange] = useState<CashFlowRange>(3);
  const [categories, setCategories] = useState<CategoryIncome[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const endMonth = currentMonth();
        const startMonth = addMonths(endMonth, -(range - 1));
        const result = await invoke<CategoryIncome[]>("get_income_by_category_for_range", {
          start_date: monthStartDate(startMonth),
          end_date: monthEndDate(endMonth),
        });
        if (!cancelled) {
          setCategories(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const totalIncomeCents = categories.reduce((sum, c) => sum + c.income_cents, 0);

  return (
    <div className="dashboard-widget reports-income-tab">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Income</h3>
        <CustomSelect
          className="dashboard-widget-period"
          ariaLabel="Income date range"
          options={CASH_FLOW_RANGE_OPTIONS.map((r) => ({ value: r, label: CASH_FLOW_RANGE_LABELS[r] }))}
          value={range}
          onChange={(val) => setRange(Number(val) as CashFlowRange)}
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="cash-flow-summary">
        <div className="cash-flow-stat">
          <span className="cash-flow-stat-label">Total Income</span>
          <span className="amount credit">{formatCents(totalIncomeCents)}</span>
        </div>
      </div>

      <IncomeByCategoryChart categories={categories} />
    </div>
  );
}

function IncomeByCategoryChart({ categories }: { categories: CategoryIncome[] }) {
  if (categories.length === 0) {
    return <p className="empty-state">No income in this range yet.</p>;
  }

  const max = Math.max(1, ...categories.map((c) => c.income_cents));

  return (
    <ul className="income-category-list">
      {categories.map((category) => (
        <li key={category.category_name} className="income-category-row">
          <div className="income-category-row-header">
            <span className="income-category-name">{category.category_name}</span>
            <span className="amount credit">{formatCents(category.income_cents)}</span>
          </div>
          <div className="income-category-bar">
            <div
              className="income-category-fill"
              style={{ width: `${(category.income_cents / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

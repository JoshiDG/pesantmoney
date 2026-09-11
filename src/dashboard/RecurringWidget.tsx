import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FREQUENCY_LABELS, RecurringItem } from "../recurring/types";
import { formatCents } from "../transactions/types";
import { CustomSelect } from "../ui/Dropdown";
import { todayIso } from "./types";

type RecurringPeriod = "7" | "14" | "30";

const PERIOD_LABELS: Record<RecurringPeriod, string> = {
  "7": "Next 7 days",
  "14": "Next 14 days",
  "30": "Next 30 days",
};

/** A short, human relative label for a due date within the next month or so. */
function relativeDueLabel(dueDate: string): string {
  const today = new Date(todayIso());
  const due = new Date(dueDate);
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "Past due";
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays < 7) return `Due in ${diffDays} days`;
  const weeks = Math.round(diffDays / 7);
  return `Due in ${weeks} week${weeks === 1 ? "" : "s"}`;
}

export function RecurringWidget() {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [period, setPeriod] = useState<RecurringPeriod>("14");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const upcoming = await invoke<RecurringItem[]>("upcoming_recurring_items_all", {
          within_days: Number(period),
        });
        if (cancelled) return;
        setItems(upcoming ?? []);
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

  const remainingDueCents = items.reduce(
    (sum, item) => (item.amount_cents < 0 ? sum + -item.amount_cents : sum),
    0,
  );

  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Recurring</h3>
        <CustomSelect
          className="dashboard-widget-period"
          ariaLabel="Recurring items period"
          options={(Object.keys(PERIOD_LABELS) as RecurringPeriod[]).map((p) => ({
            value: p,
            label: PERIOD_LABELS[p],
          }))}
          value={period}
          onChange={setPeriod}
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="recurring-remaining-due">
        <span className="recurring-remaining-due-label">Still due this period</span>
        <span className="amount debit recurring-remaining-due-amount">{formatCents(remainingDueCents)}</span>
      </div>

      {items.map((item) => (
        <div key={item.id} className="dashboard-list-row">
          <div>
            <div className="dashboard-list-row-name">{item.description}</div>
            <div className="dashboard-list-row-meta">
              {FREQUENCY_LABELS[item.frequency]} · {relativeDueLabel(item.next_expected_date)} ·{" "}
              {item.next_expected_date}
            </div>
          </div>
          <span className={`amount ${item.amount_cents < 0 ? "debit" : "credit"}`}>
            {formatCents(item.amount_cents)}
          </span>
        </div>
      ))}
      {items.length === 0 && <p className="empty-state">Nothing upcoming.</p>}
    </div>
  );
}

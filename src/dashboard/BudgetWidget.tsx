import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CategoryBudgetLine, currentMonth, formatMonth } from "../budget/types";
import { formatCents } from "../transactions/types";

interface CategoryGroupRollup {
  groupId: number;
  groupName: string;
  assignedCents: number;
  activityCents: number;
  availableCents: number;
}

function rollupByGroup(lines: CategoryBudgetLine[]): CategoryGroupRollup[] {
  const byGroup = new Map<number, CategoryGroupRollup>();
  for (const line of lines) {
    const existing = byGroup.get(line.group_id);
    if (existing) {
      existing.assignedCents += line.assigned_cents;
      existing.activityCents += line.activity_cents;
      existing.availableCents += line.available_cents;
    } else {
      byGroup.set(line.group_id, {
        groupId: line.group_id,
        groupName: line.group_name,
        assignedCents: line.assigned_cents,
        activityCents: line.activity_cents,
        availableCents: line.available_cents,
      });
    }
  }
  return Array.from(byGroup.values());
}

export function BudgetWidget() {
  const [readyToAssignCents, setReadyToAssignCents] = useState(0);
  const [groups, setGroups] = useState<CategoryGroupRollup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const month = currentMonth();
        const [readyToAssign, lines] = await Promise.all([
          invoke<number>("get_ready_to_assign", { month }),
          invoke<CategoryBudgetLine[]>("get_budget_for_month", { month }),
        ]);
        if (cancelled) return;
        setReadyToAssignCents(readyToAssign);
        setGroups(rollupByGroup(lines));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    refresh();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="dashboard-widget">
      <div className="dashboard-widget-header">
        <h3 className="dashboard-section-title">Budget · {formatMonth(currentMonth())}</h3>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="budget-rollup-ready-to-assign">
        <span className="net-worth-label">Ready to Assign</span>
        <span className={`ready-to-assign-amount ${readyToAssignCents < 0 ? "debit" : "credit"}`}>
          {formatCents(readyToAssignCents)}
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.groupId} className="budget-rollup-group">
          <div className="budget-rollup-group-name">{group.groupName}</div>
          <div className="budget-rollup-group-figures">
            <span>
              Assigned <span className="amount">{formatCents(group.assignedCents)}</span>
            </span>
            <span>
              Activity <span className="amount">{formatCents(group.activityCents)}</span>
            </span>
            <span>
              Available{" "}
              <span className={`amount ${group.availableCents < 0 ? "debit" : "credit"}`}>
                {formatCents(group.availableCents)}
              </span>
            </span>
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="empty-state">No budget categories yet.</p>}
    </div>
  );
}

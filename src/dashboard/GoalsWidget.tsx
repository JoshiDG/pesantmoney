import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GoalPaceBadge } from "../goals/GoalPaceBadge";
import { GoalWithProgress, progressFraction } from "../goals/types";
import { formatCents } from "../transactions/types";

export function GoalsWidget() {
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const fetched = await invoke<GoalWithProgress[]>("list_goals_with_progress");
        if (cancelled) return;
        setGoals(fetched ?? []);
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
        <h3 className="dashboard-section-title">Goals</h3>
      </div>

      {error && <p role="alert">{error}</p>}

      {goals.map((goal) => (
        <div key={goal.id} className="goal-widget-row">
          <div className="dashboard-list-row-name">{goal.name}</div>
          <div className="goal-progress-bar">
            <div
              className={`goal-progress-fill${goal.progress_cents < 0 ? " negative" : ""}`}
              style={{ width: `${progressFraction(goal) * 100}%` }}
            />
          </div>
          <div className="goal-progress-label">
            {formatCents(goal.progress_cents)} of {formatCents(goal.target_cents)} (
            {Math.round(progressFraction(goal) * 100)}%) <GoalPaceBadge goal={goal} />
          </div>
        </div>
      ))}
      {goals.length === 0 && (
        <p className="empty-state">No goals yet. Create one from the Goals screen to track it here.</p>
      )}
    </div>
  );
}

export interface GoalFields {
  name: string;
  target_cents: number;
  target_date: string;
  linked_category_id: number | null;
  linked_account_id: number | null;
}

export interface Goal extends GoalFields {
  id: number;
  // Only set for account-linked goals; captured automatically at creation
  // time by the backend, never supplied by the client.
  starting_balance_cents: number | null;
  created_at: string;
}

/** A Goal's on-track/ahead/behind pace classification, derived entirely from
 * existing Assigned/Transaction history -- see the "Goal Pace" term in
 * CONTEXT.md and ADR-0015. Never a separately-entered contribution amount. */
export type GoalPace = "insufficient_data" | "ahead" | "on_track" | "behind";

export const GOAL_PACE_LABELS: Record<GoalPace, string> = {
  insufficient_data: "Not enough history yet",
  ahead: "Ahead of pace",
  on_track: "On track",
  behind: "Behind pace",
};

export interface GoalWithProgress extends Goal {
  progress_cents: number;
  pace: GoalPace;
}

/** The result of a single-Account debt payoff projection (see the "Payoff
 * Projection" term in CONTEXT.md and ADR-0016): either a finite number of
 * payment periods and the resulting date, or an explicit "will not pay off"
 * signal when the hypothetical payment doesn't even cover accruing
 * interest. */
export type PayoffProjection =
  | { status: "payoff"; months: number; payoff_date: string }
  | { status: "will_not_pay_off" };

/** Fraction (0..1) of a goal's target reached, clamped for display: a
 * negative progress (a debt that grew instead of shrinking) shows as 0% on
 * a progress bar rather than going off the left edge, and progress past
 * the target caps the bar at 100% even though `progress_cents` itself is
 * left uncapped so the raw number can still be shown/inspected. */
export function progressFraction(goal: GoalWithProgress): number {
  if (goal.target_cents <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, goal.progress_cents / goal.target_cents));
}

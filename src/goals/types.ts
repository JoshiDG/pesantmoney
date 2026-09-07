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
}

export interface GoalWithProgress extends Goal {
  progress_cents: number;
}

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

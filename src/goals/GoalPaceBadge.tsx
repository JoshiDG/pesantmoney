import { GOAL_PACE_LABELS, GoalWithProgress } from "./types";

export function GoalPaceBadge({ goal }: { goal: GoalWithProgress }) {
  return <span className={`goal-pace-badge goal-pace-${goal.pace}`}>{GOAL_PACE_LABELS[goal.pace]}</span>;
}

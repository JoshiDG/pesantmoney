export interface CategoryBudgetLine {
  category_id: number;
  category_name: string;
  group_id: number;
  group_name: string;
  assigned_cents: number;
  activity_cents: number;
  available_cents: number;
}

export interface BudgetAssignmentFields {
  category_id: number;
  month: string;
  assigned_cents: number;
}

export interface BudgetAssignment extends BudgetAssignmentFields {
  id: number;
}

/** Returns this month as "YYYY-MM". */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}`.padStart(4, "0") + "-" + `${now.getMonth() + 1}`.padStart(2, "0");
}

/** Adds `delta` calendar months to a "YYYY-MM" string, wrapping the year. */
export function addMonths(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const zeroBasedTotal = year * 12 + (mon - 1) + delta;
  const newYear = Math.floor(zeroBasedTotal / 12);
  const newMonth = ((zeroBasedTotal % 12) + 12) % 12;
  return `${newYear}`.padStart(4, "0") + "-" + `${newMonth + 1}`.padStart(2, "0");
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Formats "YYYY-MM" as e.g. "March 2026" for display. */
export function formatMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return `${MONTH_LABELS[mon - 1]} ${year}`;
}

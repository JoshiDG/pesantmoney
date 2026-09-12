// Pure date-grouping logic for the Transactions grid's sticky Date Group
// headers (#93, ADR-0021/CONTEXT.md's "Date Group": Today / Yesterday /
// explicit dates). Kept free of React/DOM, same rationale as filters.ts and
// search.ts -- unit testable on its own and reusable by any already-ordered
// row list that carries an ISO `date` string, not just Transaction.

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Local-calendar (not UTC) YYYY-MM-DD for a Date, matching the format
// Transaction.date is already stored in -- comparing this string directly
// against a Transaction's date avoids the UTC-parsing pitfalls of
// `new Date(iso)` shifting the day in negative-offset timezones.
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Formats an explicit-date group header directly from the ISO string's own
// digits, rather than `new Date(dateIso)` -- same UTC-parsing pitfall as
// above.
function formatExplicitDate(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

// Today / Yesterday / an explicit "Mon D, YYYY" label, relative to `now`
// (defaults to the real clock; tests pass a fixed reference the same way
// filters.ts's datePresetRange does).
export function dateGroupLabel(dateIso: string, now: Date = new Date()): string {
  const todayIso = toIsoDate(now);
  if (dateIso === todayIso) return "Today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateIso === toIsoDate(yesterday)) return "Yesterday";

  return formatExplicitDate(dateIso);
}

export interface DateGroup<T> {
  label: string;
  rows: T[];
}

// Buckets an already-ordered row list into contiguous same-label groups,
// preserving row order within and across groups -- it never re-sorts a row.
// A caller that wants Today/Yesterday/date buckets on a genuinely
// chronological grid must pass rows already sorted by date (see
// TransactionsGrid's date-desc default and its own header-click sortState
// override); grouping a non-date-ordered list is still well-defined (every
// date change starts a new group), it will just produce as many groups as
// there are date transitions.
export function groupRowsByDate<T>(
  rows: T[],
  getDate: (row: T) => string,
  now: Date = new Date(),
): DateGroup<T>[] {
  const groups: DateGroup<T>[] = [];
  for (const row of rows) {
    const label = dateGroupLabel(getDate(row), now);
    const current = groups[groups.length - 1];
    if (current && current.label === label) {
      current.rows.push(row);
    } else {
      groups.push({ label, rows: [row] });
    }
  }
  return groups;
}

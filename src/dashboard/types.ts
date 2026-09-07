import { Account } from "../accounts/types";
import { addMonths, currentMonth } from "../budget/types";

/** A tuple `[Account, balance_cents]` as returned by `get_net_worth_by_account`. */
export type AccountBalance = [Account, number];

/** `[income_cents, expense_cents]` as returned by `get_cash_flow_for_range`. */
export type CashFlow = [number, number];

/** Account types whose balance is an asset (money the user has). */
const ASSET_TYPES = new Set(["checking", "savings", "cash", "investment"]);

/** True when `account_type`'s balance counts as an asset rather than a liability. */
export function isAssetType(accountType: Account["account_type"]): boolean {
  return ASSET_TYPES.has(accountType);
}

/** Splits and sorts a `net_worth_by_account` result into assets then liabilities,
 * each ordered by balance descending, for a sensible dashboard breakdown. */
export function sortForBreakdown(rows: AccountBalance[]): AccountBalance[] {
  const assets = rows.filter(([account]) => isAssetType(account.account_type));
  const liabilities = rows.filter(([account]) => !isAssetType(account.account_type));
  assets.sort((a, b) => b[1] - a[1]);
  liabilities.sort((a, b) => a[1] - b[1]);
  return [...assets, ...liabilities];
}

/** "YYYY-MM-DD" for the first calendar day of `month` ("YYYY-MM"). */
export function monthStartDate(month: string): string {
  return `${month}-01`;
}

/** "YYYY-MM-DD" for the last calendar day of `month` ("YYYY-MM"). */
export function monthEndDate(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** The last `count` calendar months (oldest first), ending with the current month. */
export function lastMonths(count: number): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    months.push(addMonths(currentMonth(), -i));
  }
  return months;
}

const SHORT_MONTH_LABELS = [
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

/** Formats "YYYY-MM" as a short label like "Aug" for a compact chart axis. */
export function formatMonthShort(month: string): string {
  const mon = Number(month.split("-")[1]);
  return SHORT_MONTH_LABELS[mon - 1];
}

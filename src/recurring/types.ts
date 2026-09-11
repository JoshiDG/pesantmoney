export type Frequency = "weekly" | "biweekly" | "monthly" | "yearly";

export interface RecurringItemFields {
  description: string;
  amount_cents: number;
  frequency: Frequency;
  next_expected_date: string;
  category_id: number | null;
}

export interface RecurringItem extends RecurringItemFields {
  id: number;
  account_id: number;
  is_confirmed: boolean;
}

// A RecurringItem carrying its Account's name alongside it, returned by the
// `list_all_recurring_items` command backing the all-Accounts Recurring
// screen (#52).
export interface RecurringItemWithAccount extends RecurringItem {
  account_name: string;
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as Frequency[];

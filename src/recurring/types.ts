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

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as Frequency[];

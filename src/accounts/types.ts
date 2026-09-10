export type AccountType =
  | "checking"
  | "savings"
  | "credit_card"
  | "investment"
  | "loan"
  | "cash";

export interface AccountFields {
  name: string;
  account_type: AccountType;
  institution_name: string | null;
}

export interface Account extends AccountFields {
  id: number;
  // Optional, manually-entered Annual Percentage Rate in basis points (1% =
  // 100 bps). Only meaningful for debt-shaped accounts (credit_card, loan);
  // powers the payoff-projection calculator, never Goal progress.
  apr_bps: number | null;
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit_card: "Credit Card",
  investment: "Investment",
  loan: "Loan",
  cash: "Cash",
};

export const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[];

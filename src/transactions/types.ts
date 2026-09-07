export interface TransactionFields {
  date: string;
  amount_cents: number;
  description: string;
  category_id: number | null;
}

export interface Transaction extends TransactionFields {
  id: number;
  account_id: number;
}

export function centsToDollarInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function dollarInputToCents(value: string): number {
  return Math.round(parseFloat(value) * 100);
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

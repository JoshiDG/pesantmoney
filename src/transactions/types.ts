export interface TransactionFields {
  date: string;
  amount_cents: number;
  description: string;
  category_id: number | null;
}

export interface Transaction extends TransactionFields {
  id: number;
  account_id: number;
  // Identified merchant name (Merchant-dictionary match at import time, or a
  // Categorization Rule's rename action). Display-only: never a substitute
  // for `description`, which stays the raw imported/edited source of truth.
  merchant_name: string | null;
  hidden: boolean;
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

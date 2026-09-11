// Column visibility for the Transactions grid's Column Set (see
// CONTEXT.md's "Column Management" glossary entry). One global config for
// the whole app -- not per-view, not per-Account -- persisted on the
// backend `Settings` struct (see `update_transaction_column_visibility`).
export interface ColumnVisibility {
  date: boolean;
  account: boolean;
  payee: boolean;
  memo: boolean;
  category: boolean;
  tags: boolean;
  amount: boolean;
  running_balance: boolean;
}

export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  date: true,
  account: true,
  payee: true,
  memo: true,
  category: true,
  tags: true,
  amount: true,
  running_balance: true,
};

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
  // Present only on rows returned by `list_all_transactions` (the
  // all-Accounts Transactions view, #51) -- absent on rows from the
  // per-Account `list_transactions`. Optional here (rather than a
  // TransactionsGrid-specific type) so the grid can render an Account
  // badge whenever it's given, without needing two parallel row shapes.
  account_name?: string;
}

// Returned by `list_all_transactions`: every field `list_transactions`
// returns, plus the owning Account's name.
export interface TransactionWithAccount extends Transaction {
  account_name: string;
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

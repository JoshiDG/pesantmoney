export interface HoldingFields {
  ticker: string;
  quantity: number;
  cost_basis_cents: number | null;
}

export interface Holding extends HoldingFields {
  id: number;
  account_id: number;
}

/// A holding joined with its latest known price + computed value, as
/// returned by `list_holdings_with_values`. `price_cents`/`as_of_date`/
/// `value_cents` are all null together when the ticker has never had a
/// price entered -- render that as "no price yet", never as $0.
export interface HoldingWithValue extends HoldingFields {
  id: number;
  account_id: number;
  price_cents: number | null;
  as_of_date: string | null;
  value_cents: number | null;
}

/// A `HoldingWithValue` plus the identifying Account it belongs to, as
/// returned by `list_all_holdings_with_values` -- the all-Accounts
/// Investments screen's query. `account_name` lets a mixed list of rows from
/// multiple Accounts stay legible.
export interface HoldingWithAccount extends HoldingWithValue {
  account_name: string;
}

export interface SecurityPrice {
  id: number;
  ticker: string;
  price_cents: number;
  as_of_date: string;
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

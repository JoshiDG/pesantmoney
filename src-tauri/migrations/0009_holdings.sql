-- Holdings: a position (ticker + quantity) a user manually enters for an
-- Investment account. Quantity is REAL to support fractional shares (common
-- with brokerage DRIP/fractional-share purchases). cost_basis_cents is the
-- total cost basis for the position (optional, nullable).
CREATE TABLE holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    quantity REAL NOT NULL,
    cost_basis_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX holdings_account_id_idx ON holdings (account_id);
CREATE INDEX holdings_ticker_idx ON holdings (ticker);

-- Security prices: a per-ticker price history, populated only by manual
-- entry or importing a price file (never a live/network price feed --
-- see ADR-0003). The current price for a ticker is the row with the
-- latest as_of_date. A ticker may have at most one price row per
-- as_of_date (re-entering the same day's price updates it in place).
CREATE TABLE security_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    as_of_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (ticker, as_of_date)
);

CREATE INDEX security_prices_ticker_idx ON security_prices (ticker);

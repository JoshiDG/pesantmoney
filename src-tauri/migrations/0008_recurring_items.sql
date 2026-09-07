CREATE TABLE recurring_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    frequency TEXT NOT NULL CHECK (
        frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')
    ),
    next_expected_date TEXT NOT NULL,
    category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
    is_confirmed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX recurring_items_account_id_idx ON recurring_items (account_id);
CREATE INDEX recurring_items_category_id_idx ON recurring_items (category_id);

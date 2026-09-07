CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    target_cents INTEGER NOT NULL,
    target_date TEXT NOT NULL,
    linked_category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
    linked_account_id INTEGER REFERENCES accounts (id) ON DELETE CASCADE,
    starting_balance_cents INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX goals_linked_category_id_idx ON goals (linked_category_id);
CREATE INDEX goals_linked_account_id_idx ON goals (linked_account_id);

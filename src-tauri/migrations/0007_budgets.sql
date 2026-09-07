CREATE TABLE budget_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    assigned_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (category_id, month)
);

CREATE INDEX budget_assignments_month_idx ON budget_assignments (month);

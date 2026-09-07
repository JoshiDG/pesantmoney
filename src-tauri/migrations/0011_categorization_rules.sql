CREATE TABLE categorization_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field TEXT NOT NULL CHECK (
        field IN ('description', 'amount', 'account')
    ),
    match_type TEXT NOT NULL CHECK (
        match_type IN ('contains', 'equals')
    ),
    match_value TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX categorization_rules_category_id_idx ON categorization_rules (category_id);
CREATE INDEX categorization_rules_priority_idx ON categorization_rules (priority);

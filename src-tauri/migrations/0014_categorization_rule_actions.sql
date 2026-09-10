-- #37/#39: a Categorization Rule's effect grows from "assign exactly one
-- category" to a small set of independent, optional actions: assign a
-- category, rename the merchant, and/or hide the Transaction (tag
-- attachment is added by the next migration, since it needs a join table).
-- `category_id` therefore becomes nullable -- a rule with only a rename
-- value or only `hide` is valid. SQLite can't drop a NOT NULL constraint or
-- change a CHECK in place, so the table is rebuilt.
PRAGMA foreign_keys = OFF;

ALTER TABLE categorization_rules RENAME TO categorization_rules_old;

CREATE TABLE categorization_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field TEXT NOT NULL CHECK (
        field IN ('description', 'amount', 'account')
    ),
    match_type TEXT NOT NULL CHECK (
        match_type IN ('contains', 'equals')
    ),
    match_value TEXT NOT NULL,
    category_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
    rename_value TEXT,
    hide INTEGER NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO categorization_rules (
    id, field, match_type, match_value, category_id, priority, created_at, updated_at
)
SELECT id, field, match_type, match_value, category_id, priority, created_at, updated_at
FROM categorization_rules_old;

DROP TABLE categorization_rules_old;

CREATE INDEX categorization_rules_category_id_idx ON categorization_rules (category_id);
CREATE INDEX categorization_rules_priority_idx ON categorization_rules (priority);

PRAGMA foreign_keys = ON;

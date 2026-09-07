CREATE TABLE category_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES category_groups (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX categories_group_id_idx ON categories (group_id);

ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL;

CREATE INDEX transactions_category_id_idx ON transactions (category_id);

-- Starter categories so the app isn't empty on first run; fully user-editable afterward.
INSERT INTO category_groups (id, name) VALUES
    (1, 'Income'),
    (2, 'Housing'),
    (3, 'Transportation'),
    (4, 'Food'),
    (5, 'Subscriptions'),
    (6, 'Personal'),
    (7, 'Everything Else');

INSERT INTO categories (group_id, name) VALUES
    (1, 'Paycheck'),
    (1, 'Interest'),
    (1, 'Other Income'),
    (2, 'Rent/Mortgage'),
    (2, 'Utilities'),
    (2, 'Home Maintenance'),
    (3, 'Gas'),
    (3, 'Public Transit'),
    (3, 'Auto Payment'),
    (4, 'Groceries'),
    (4, 'Restaurants'),
    (5, 'Streaming Services'),
    (5, 'Software'),
    (6, 'Shopping'),
    (6, 'Health & Wellness'),
    (7, 'Uncategorized');

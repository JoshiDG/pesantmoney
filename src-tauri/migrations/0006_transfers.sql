CREATE TABLE transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE,
    to_transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-column UNIQUE constraints (each auto-indexed by SQLite) stop a
-- Transaction being reused in the same role (from/to) across two Transfers.
-- They can't by themselves stop a Transaction linked as
-- `from_transaction_id` in one row from also being linked as
-- `to_transaction_id` in another, so the service layer additionally checks
-- both columns before inserting.

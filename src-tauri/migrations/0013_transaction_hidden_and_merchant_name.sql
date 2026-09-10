-- #39: a Transaction can be hidden (excluded from the default Transactions
-- list and from all income/expense/budget/report totals, same strength of
-- exclusion as a linked Transfer -- see ADR-0014). Independently reversible,
-- not tied to any particular rule.
ALTER TABLE transactions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

-- #37: the display name a Categorization Rule (or, later, Merchant-dictionary
-- matching -- see ADR-0012/issue #36) assigns to a Transaction, kept
-- separate from the raw `description` column so import-dedup fingerprinting
-- (ADR-0002) stays stable regardless of renames.
ALTER TABLE transactions ADD COLUMN merchant_name TEXT;

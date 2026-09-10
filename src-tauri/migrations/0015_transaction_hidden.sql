-- #39: a Transaction can be hidden (excluded from the default Transactions
-- list and from all income/expense/budget/report totals, same strength of
-- exclusion as a linked Transfer -- see ADR-0014). Independently reversible,
-- not tied to any particular rule.
--
-- `merchant_name` (the display name a Categorization Rule's rename action
-- assigns to a Transaction) was already added by migration 0014 as part of
-- Merchant-dictionary matching (#36); the rename action reuses that column
-- rather than adding a second one.
ALTER TABLE transactions ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

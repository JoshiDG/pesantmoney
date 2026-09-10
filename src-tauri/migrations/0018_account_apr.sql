-- Optional, manually-entered APR (Annual Percentage Rate) on an Account, in
-- basis points (1% = 100 bps) to avoid float rounding issues. Meaningful for
-- debt-shaped Accounts (credit_card, loan) but not restricted at the DB
-- layer to those types. Never fetched or inferred -- see ADR-0003's
-- no-live-data precedent for rate/price data. Powers the payoff-projection
-- what-if calculator in `services::goals`; never affects Goal progress.
ALTER TABLE accounts ADD COLUMN apr_bps INTEGER;

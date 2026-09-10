-- Merchant: a keyword-to-canonical-name mapping used to identify a clean
-- Merchant name from a Transaction's raw imported description (see issue
-- #36 and CONTEXT.md's Categorization Rule entry — entirely local, no cloud
-- lookup). `keyword` is matched case-insensitively as a substring against
-- normalized descriptions at Import time; `merchant_name` is the canonical
-- display name to show when a keyword matches.
--
-- Keywords are unique case-insensitively, enforced via a unique index over
-- lower(keyword) rather than a CHECK, since SQLite's COLLATE NOCASE unique
-- index is the standard way to express this.
CREATE TABLE merchants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    merchant_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX merchants_keyword_unique_idx ON merchants (keyword COLLATE NOCASE);

-- Seed data: a small curated dictionary of common US merchants and
-- payment-processor prefixes, editable/deletable like any other entry post-
-- seed (no "built-in, protected" status — see issue #36).
INSERT INTO merchants (keyword, merchant_name) VALUES
    ('SQ *', 'Square Merchant'),
    ('TST*', 'Toast POS Merchant'),
    ('PAYPAL *', 'PayPal Merchant'),
    ('POS ', 'Point of Sale Purchase'),
    ('starbucks', 'Starbucks'),
    ('blue bottle', 'Blue Bottle Coffee'),
    ('peets coffee', 'Peet''s Coffee'),
    ('dunkin', 'Dunkin'''),
    ('philz coffee', 'Philz Coffee'),
    ('mcdonald', 'McDonald''s'),
    ('chipotle', 'Chipotle'),
    ('panera', 'Panera Bread'),
    ('subway', 'Subway'),
    ('chick-fil-a', 'Chick-fil-A'),
    ('chickfila', 'Chick-fil-A'),
    ('taco bell', 'Taco Bell'),
    ('wendys', 'Wendy''s'),
    ('burger king', 'Burger King'),
    ('domino', 'Domino''s Pizza'),
    ('pizza hut', 'Pizza Hut'),
    ('shake shack', 'Shake Shack'),
    ('in-n-out', 'In-N-Out Burger'),
    ('sweetgreen', 'Sweetgreen'),
    ('uber eats', 'Uber Eats'),
    ('doordash', 'DoorDash'),
    ('grubhub', 'Grubhub'),
    ('postmates', 'Postmates'),
    ('uber', 'Uber'),
    ('lyft', 'Lyft'),
    ('netflix', 'Netflix'),
    ('hulu', 'Hulu'),
    ('spotify', 'Spotify'),
    ('disney plus', 'Disney+'),
    ('disneyplus', 'Disney+'),
    ('hbo max', 'HBO Max'),
    ('amazon prime', 'Amazon Prime'),
    ('amzn mktp', 'Amazon'),
    ('amazon.com', 'Amazon'),
    ('apple.com/bill', 'Apple'),
    ('google *', 'Google'),
    ('whole foods', 'Whole Foods Market'),
    ('trader joe', 'Trader Joe''s'),
    ('safeway', 'Safeway'),
    ('kroger', 'Kroger'),
    ('costco', 'Costco'),
    ('target', 'Target'),
    ('walmart', 'Walmart'),
    ('walgreens', 'Walgreens'),
    ('cvs', 'CVS Pharmacy'),
    ('7-eleven', '7-Eleven'),
    ('7 eleven', '7-Eleven'),
    ('home depot', 'The Home Depot'),
    ('lowes', 'Lowe''s'),
    ('best buy', 'Best Buy'),
    ('ikea', 'IKEA'),
    ('shell oil', 'Shell'),
    ('chevron', 'Chevron'),
    ('exxon', 'ExxonMobil'),
    ('delta air', 'Delta Air Lines'),
    ('united airlines', 'United Airlines'),
    ('southwest air', 'Southwest Airlines'),
    ('airbnb', 'Airbnb'),
    ('marriott', 'Marriott'),
    ('hilton', 'Hilton'),
    ('planet fitness', 'Planet Fitness'),
    ('equinox', 'Equinox'),
    ('at&t', 'AT&T'),
    ('verizon', 'Verizon'),
    ('t-mobile', 'T-Mobile'),
    ('comcast', 'Comcast'),
    ('xfinity', 'Xfinity'),
    ('venmo', 'Venmo'),
    ('zelle', 'Zelle'),
    ('western union', 'Western Union');

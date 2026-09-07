-- Import Profiles: a saved CSV column mapping for a specific Institution's
-- export shape, reused across repeated Imports from that source. OFX/QFX
-- files are self-describing and never need one.
CREATE TABLE import_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    institution_name TEXT NOT NULL,
    date_column INTEGER NOT NULL,
    amount_column INTEGER NOT NULL,
    description_column INTEGER NOT NULL,
    sign_convention TEXT NOT NULL CHECK (
        sign_convention IN ('negative_is_debit', 'negative_is_credit')
    ),
    has_header_row INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

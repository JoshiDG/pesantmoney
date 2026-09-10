-- #38: Tag is a first-class entity, many-to-many with Transaction (ADR-0013)
-- -- a flat, ungrouped lookup table like `categories`, not a free-text field.
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transaction_tags (
    transaction_id INTEGER NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (transaction_id, tag_id)
);

CREATE INDEX transaction_tags_tag_id_idx ON transaction_tags (tag_id);

-- A Categorization Rule's tag action: zero or more Tags to attach on match,
-- additive to (never a replacement for) its category assignment.
CREATE TABLE categorization_rule_tags (
    rule_id INTEGER NOT NULL REFERENCES categorization_rules (id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, tag_id)
);

CREATE INDEX categorization_rule_tags_tag_id_idx ON categorization_rule_tags (tag_id);

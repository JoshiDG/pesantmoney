-- Adds the identified Merchant name as a derived field on Transaction,
-- separate from the raw `description` column (see issue #36 and
-- CONTEXT.md's Categorization Rule / Import entries). `description` remains
-- the untouched source-of-truth used by import-dedup fingerprinting
-- (src-tauri/src/import/fingerprint.rs); `merchant_name` is populated once,
-- at Import time, from a Merchant keyword match and is never used for
-- dedup. Nullable: absent when no keyword matched.
ALTER TABLE transactions ADD COLUMN merchant_name TEXT;

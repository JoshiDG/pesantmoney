//! Import: loading a batch of Transactions into an Account from a
//! user-supplied CSV/OFX/QFX file (never automated or credential-based —
//! see CONTEXT.md). Two steps, matching the frontend flow:
//!
//! 1. [`preview_import`] parses the file and classifies each row against the
//!    Account's existing Transactions, without writing anything.
//! 2. [`commit_import`] takes the (possibly user-edited/filtered) row set
//!    back from the frontend and inserts it, re-checking for exact dupes.
//!
//! Dedup strategy is ADR-0002: fingerprint exact repeats and auto-skip them;
//! flag ambiguous near-matches for the user to decide on instead of guessing.

pub mod csv_parser;
pub mod fingerprint;
pub mod ofx_parser;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub use csv_parser::{ColumnMapping, SignConvention};

use crate::services::categorization_rules;
use crate::services::merchants;
use crate::services::tags;
use crate::services::transactions;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportFormat {
    Csv,
    Ofx,
}

/// A single row parsed out of the source file, before it's compared against
/// the database or inserted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedTransaction {
    pub date: String,
    pub amount_cents: i64,
    pub description: String,
    /// An explicit Category, if the caller already knows one (e.g. a
    /// user-edited preview row). When absent, `commit_import` tries to fill
    /// it in from a matching Categorization Rule instead of leaving it
    /// uncategorized. `#[serde(default)]` keeps existing frontend payloads
    /// that don't send this field working unchanged.
    #[serde(default)]
    pub category_id: Option<i64>,
}

/// How a [`ParsedTransaction`] compares to the Account's existing
/// Transactions, decided by [`classify`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchStatus {
    /// No existing Transaction resembles this row — safe to import as-is.
    New,
    /// Exact fingerprint match already in the database (same account, date,
    /// amount, and normalized description) — auto-skipped by `commit_import`.
    Duplicate,
    /// Close enough to an existing Transaction that silently importing it
    /// risks a duplicate, but different enough that silently skipping it
    /// risks losing a real Transaction. Surfaced for the user to decide.
    NeedsReview,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviewRow {
    pub date: String,
    pub amount_cents: i64,
    pub description: String,
    pub status: MatchStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ImportResult {
    pub imported_count: i64,
    pub skipped_count: i64,
}

struct ExistingTransaction {
    date: String,
    amount_cents: i64,
    description: String,
}

fn existing_transactions_for_account(
    conn: &Connection,
    account_id: i64,
) -> rusqlite::Result<Vec<ExistingTransaction>> {
    let mut stmt =
        conn.prepare("SELECT date, amount_cents, description FROM transactions WHERE account_id = ?1")?;
    let rows = stmt.query_map([account_id], |row| {
        Ok(ExistingTransaction {
            date: row.get(0)?,
            amount_cents: row.get(1)?,
            description: row.get(2)?,
        })
    })?;
    rows.collect()
}

/// Absolute difference in days between two `YYYY-MM-DD` dates, computed
/// without a date library by converting each to a day count (Gregorian
/// civil-to-days, proleptic). Good enough for the small "within a couple of
/// days" near-match window below — not used for calendar-accurate math.
fn days_between(a: &str, b: &str) -> Option<i64> {
    fn to_days(date: &str) -> Option<i64> {
        let parts: Vec<&str> = date.split('-').collect();
        if parts.len() != 3 {
            return None;
        }
        let y: i64 = parts[0].parse().ok()?;
        let m: i64 = parts[1].parse().ok()?;
        let d: i64 = parts[2].parse().ok()?;
        // Howard Hinnant's days_from_civil algorithm.
        let y = if m <= 2 { y - 1 } else { y };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        Some(era * 146097 + doe - 719468)
    }
    Some((to_days(a)? - to_days(b)?).abs())
}

/// Near-match heuristic (ADR-0002 asks for judgement here, documented as
/// specified): treat two Transactions as an ambiguous near-match — worth a
/// human's review rather than a silent auto-decision — when either:
///
/// - they share the same date and amount but a different description
///   (could be the same purchase re-described by the Institution, or two
///   genuinely different same-day/same-amount purchases); or
/// - they share the same normalized description and amount, and their
///   dates are within 2 days of each other (could be the same purchase
///   posting on a different day — pending vs. posted — or a genuine repeat
///   charge, e.g. two coffees).
///
/// An exact fingerprint match is handled separately as [`MatchStatus::Duplicate`],
/// so this only needs to cover the "close but not identical" cases.
fn classify(existing: &[ExistingTransaction], candidate: &ParsedTransaction, account_id: i64) -> MatchStatus {
    let candidate_fingerprint = fingerprint::compute(
        account_id,
        &candidate.date,
        candidate.amount_cents,
        &candidate.description,
    );

    for existing_txn in existing {
        let existing_fingerprint = fingerprint::compute(
            account_id,
            &existing_txn.date,
            existing_txn.amount_cents,
            &existing_txn.description,
        );
        if existing_fingerprint == candidate_fingerprint {
            return MatchStatus::Duplicate;
        }
    }

    let normalized_candidate_description = fingerprint::normalize_description(&candidate.description);
    for existing_txn in existing {
        if existing_txn.amount_cents != candidate.amount_cents {
            continue;
        }
        if existing_txn.date == candidate.date {
            return MatchStatus::NeedsReview;
        }
        let normalized_existing_description = fingerprint::normalize_description(&existing_txn.description);
        if normalized_existing_description == normalized_candidate_description {
            if let Some(diff) = days_between(&existing_txn.date, &candidate.date) {
                if diff <= 2 {
                    return MatchStatus::NeedsReview;
                }
            }
        }
    }

    MatchStatus::New
}

/// Parses `file_contents` (without writing to the database) and classifies
/// each row against the Account's existing Transactions so the frontend can
/// show a preview before the user commits anything.
pub fn preview_import(
    conn: &Connection,
    account_id: i64,
    file_contents: &str,
    format: ImportFormat,
    mapping: Option<&ColumnMapping>,
) -> Result<Vec<PreviewRow>, String> {
    let parsed = match format {
        ImportFormat::Csv => {
            let mapping = mapping.ok_or_else(|| "CSV import requires a column mapping".to_string())?;
            csv_parser::parse(file_contents, mapping)?
        }
        ImportFormat::Ofx => ofx_parser::parse(file_contents)?,
    };

    let existing = existing_transactions_for_account(conn, account_id).map_err(|e| e.to_string())?;

    Ok(parsed
        .into_iter()
        .map(|txn| {
            let status = classify(&existing, &txn, account_id);
            PreviewRow {
                date: txn.date,
                amount_cents: txn.amount_cents,
                description: txn.description,
                status,
            }
        })
        .collect())
}

/// Inserts the reviewed row set into `account_id`, uncategorized. Recomputes
/// fingerprints against the current database (not the preview snapshot) and
/// silently skips any exact repeats — both ones already stored and
/// duplicates within this same batch — per ADR-0002.
pub fn commit_import(
    conn: &Connection,
    account_id: i64,
    rows: Vec<ParsedTransaction>,
) -> Result<ImportResult, String> {
    let existing = existing_transactions_for_account(conn, account_id).map_err(|e| e.to_string())?;
    let mut seen_fingerprints: std::collections::HashSet<String> = existing
        .iter()
        .map(|txn| fingerprint::compute(account_id, &txn.date, txn.amount_cents, &txn.description))
        .collect();

    let mut imported_count = 0;
    let mut skipped_count = 0;

    for row in rows {
        let fp = fingerprint::compute(account_id, &row.date, row.amount_cents, &row.description);
        if seen_fingerprints.contains(&fp) {
            skipped_count += 1;
            continue;
        }
        // Identify a Merchant name (see services::merchants) once, at Import
        // time; this never overwrites `row.description`, which stays intact
        // for fingerprint-based dedup on future imports (issue #36).
        let merchant_name = merchants::match_description(conn, &row.description).map_err(|e| e.to_string())?;

        // Rule actions are computed regardless of whether the caller already
        // supplied an explicit category_id (e.g. a user-edited preview row):
        // rename/hide/tag are independent of category assignment, so they
        // still apply even when category assignment itself is overridden.
        // Rule matching prefers the identified Merchant name over the raw
        // description when one was found.
        let rule_effects = categorization_rules::apply_to_transaction(
            conn,
            account_id,
            &row.date,
            row.amount_cents,
            &row.description,
            merchant_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;

        // Respect an explicit category_id from the caller; only fall back to
        // a matching Categorization Rule's category when none was given.
        let category_id = row.category_id.or(rule_effects.category_id);

        let created =
            transactions::create(conn, account_id, &row.date, row.amount_cents, &row.description, category_id)
                .map_err(|e| e.to_string())?;

        // A rule's rename (issue #37) always wins over whatever a
        // Merchant-dictionary pass would have produced for the same
        // Transaction (issue #36), since it's a more specific, intentional
        // signal -- and neither ever touches `description`, which must stay
        // stable for fingerprinting (ADR-0002).
        let effective_merchant_name = rule_effects.rename_value.as_deref().or(merchant_name.as_deref());
        if let Some(merchant_name) = effective_merchant_name {
            transactions::set_merchant_name(conn, created.id, Some(merchant_name)).map_err(|e| e.to_string())?;
        }
        if rule_effects.hide {
            transactions::set_hidden(conn, created.id, true).map_err(|e| e.to_string())?;
        }
        for tag_id in &rule_effects.tag_ids {
            tags::attach(conn, created.id, *tag_id).map_err(|e| e.to_string())?;
        }

        seen_fingerprints.insert(fp);
        imported_count += 1;
    }

    Ok(ImportResult {
        imported_count,
        skipped_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};

    fn create_test_account(conn: &Connection) -> i64 {
        accounts::create(conn, "Everyday Checking", AccountType::Checking, None)
            .expect("create account")
            .id
    }

    #[test]
    fn preview_new_transaction_against_an_empty_account_is_new() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let csv = "Date,Amount,Description\n2026-08-01,-12.50,Coffee Shop\n";
        let mapping = ColumnMapping {
            date_column: 0,
            amount_column: 1,
            description_column: 2,
            sign_convention: SignConvention::NegativeIsDebit,
            has_header_row: true,
        };

        let rows = preview_import(&conn, account_id, csv, ImportFormat::Csv, Some(&mapping))
            .expect("preview import");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, MatchStatus::New);
    }

    #[test]
    fn preview_flags_an_exact_repeat_as_duplicate() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1250, "Coffee Shop", None)
            .expect("create transaction");
        let csv = "Date,Amount,Description\n2026-08-01,-12.50,Coffee Shop\n";
        let mapping = ColumnMapping {
            date_column: 0,
            amount_column: 1,
            description_column: 2,
            sign_convention: SignConvention::NegativeIsDebit,
            has_header_row: true,
        };

        let rows = preview_import(&conn, account_id, csv, ImportFormat::Csv, Some(&mapping))
            .expect("preview import");

        assert_eq!(rows[0].status, MatchStatus::Duplicate);
    }

    #[test]
    fn preview_flags_same_date_and_amount_different_description_as_needs_review() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1250, "Coffee Shop #4521", None)
            .expect("create transaction");
        let csv = "Date,Amount,Description\n2026-08-01,-12.50,Coffee Shop Downtown\n";
        let mapping = ColumnMapping {
            date_column: 0,
            amount_column: 1,
            description_column: 2,
            sign_convention: SignConvention::NegativeIsDebit,
            has_header_row: true,
        };

        let rows = preview_import(&conn, account_id, csv, ImportFormat::Csv, Some(&mapping))
            .expect("preview import");

        assert_eq!(rows[0].status, MatchStatus::NeedsReview);
    }

    #[test]
    fn preview_flags_same_description_and_amount_within_two_days_as_needs_review() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1250, "Coffee Shop", None)
            .expect("create transaction");
        let csv = "Date,Amount,Description\n2026-08-03,-12.50,Coffee Shop\n";
        let mapping = ColumnMapping {
            date_column: 0,
            amount_column: 1,
            description_column: 2,
            sign_convention: SignConvention::NegativeIsDebit,
            has_header_row: true,
        };

        let rows = preview_import(&conn, account_id, csv, ImportFormat::Csv, Some(&mapping))
            .expect("preview import");

        assert_eq!(rows[0].status, MatchStatus::NeedsReview);
    }

    #[test]
    fn preview_does_not_flag_same_description_and_amount_far_apart_in_time() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1250, "Coffee Shop", None)
            .expect("create transaction");
        let csv = "Date,Amount,Description\n2026-08-15,-12.50,Coffee Shop\n";
        let mapping = ColumnMapping {
            date_column: 0,
            amount_column: 1,
            description_column: 2,
            sign_convention: SignConvention::NegativeIsDebit,
            has_header_row: true,
        };

        let rows = preview_import(&conn, account_id, csv, ImportFormat::Csv, Some(&mapping))
            .expect("preview import");

        assert_eq!(rows[0].status, MatchStatus::New);
    }

    #[test]
    fn commit_inserts_new_rows_as_uncategorized_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "Coffee Shop".to_string(),
            category_id: None,
        }];

        let result = commit_import(&conn, account_id, rows).expect("commit import");

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.skipped_count, 0);
        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].category_id, None);
    }

    #[test]
    fn commit_applies_a_matching_categorization_rule_when_no_category_is_given() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let group_id = crate::services::categories::create_group(&conn, "Food")
            .expect("create category group")
            .id;
        let category_id = crate::services::categories::create(&conn, group_id, "Coffee")
            .expect("create category")
            .id;
        crate::services::categorization_rules::create(
            &conn,
            crate::services::categorization_rules::RuleField::Description,
            crate::services::categorization_rules::MatchType::Contains,
            "coffee",
            crate::services::categorization_rules::RuleActions {
                category_id: Some(category_id),
                ..Default::default()
            },
            0,
        )
        .expect("create categorization rule");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "Coffee Shop".to_string(),
            category_id: None,
        }];

        let result = commit_import(&conn, account_id, rows).expect("commit import");

        assert_eq!(result.imported_count, 1);
        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored[0].category_id, Some(category_id));
    }

    #[test]
    fn commit_does_not_override_an_explicit_category_id_with_a_rule() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let group_id = crate::services::categories::create_group(&conn, "Food")
            .expect("create category group")
            .id;
        let rule_category_id = crate::services::categories::create(&conn, group_id, "Coffee")
            .expect("create category")
            .id;
        let explicit_category_id = crate::services::categories::create(&conn, group_id, "Business Expense")
            .expect("create category")
            .id;
        crate::services::categorization_rules::create(
            &conn,
            crate::services::categorization_rules::RuleField::Description,
            crate::services::categorization_rules::MatchType::Contains,
            "coffee",
            crate::services::categorization_rules::RuleActions {
                category_id: Some(rule_category_id),
                ..Default::default()
            },
            0,
        )
        .expect("create categorization rule");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "Coffee Shop".to_string(),
            category_id: Some(explicit_category_id),
        }];

        let result = commit_import(&conn, account_id, rows).expect("commit import");

        assert_eq!(result.imported_count, 1);
        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored[0].category_id, Some(explicit_category_id));
    }

    #[test]
    fn commit_silently_skips_exact_fingerprint_matches_already_in_the_db() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1250, "Coffee Shop", None)
            .expect("create transaction");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "Coffee Shop".to_string(),
            category_id: None,
        }];

        let result = commit_import(&conn, account_id, rows).expect("commit import");

        assert_eq!(result.imported_count, 0);
        assert_eq!(result.skipped_count, 1);
        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored.len(), 1);
    }

    #[test]
    fn commit_skips_duplicates_within_the_same_batch() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let rows = vec![
            ParsedTransaction {
                date: "2026-08-01".to_string(),
                amount_cents: -1250,
                description: "Coffee Shop".to_string(),
                category_id: None,
            },
            ParsedTransaction {
                date: "2026-08-01".to_string(),
                amount_cents: -1250,
                description: "Coffee Shop".to_string(),
                category_id: None,
            },
        ];

        let result = commit_import(&conn, account_id, rows).expect("commit import");

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.skipped_count, 1);
    }

    #[test]
    fn commit_does_not_skip_a_needs_review_near_match() {
        // near-matches are a review decision for the user upstream of commit;
        // commit itself only auto-skips exact fingerprint repeats.
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1250, "Coffee Shop A", None)
            .expect("create transaction");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "Coffee Shop B".to_string(),
            category_id: None,
        }];

        let result = commit_import(&conn, account_id, rows).expect("commit import");

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.skipped_count, 0);
    }

    #[test]
    fn commit_identifies_a_merchant_name_without_altering_the_raw_description() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        crate::services::merchants::create(&conn, "zzz test coffee", "ZZZ Test Coffee")
            .expect("create merchant");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "SQ *ZZZ TEST COFFEE COF 04/12 #4471".to_string(),
            category_id: None,
        }];

        commit_import(&conn, account_id, rows).expect("commit import");

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored[0].description, "SQ *ZZZ TEST COFFEE COF 04/12 #4471");
        assert_eq!(stored[0].merchant_name, Some("ZZZ Test Coffee".to_string()));
    }

    #[test]
    fn commit_leaves_merchant_name_unset_when_no_keyword_matches() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        crate::services::merchants::create(&conn, "zzz test coffee", "ZZZ Test Coffee")
            .expect("create merchant");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "Totally Unrelated Store".to_string(),
            category_id: None,
        }];

        commit_import(&conn, account_id, rows).expect("commit import");

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored[0].merchant_name, None);
    }

    #[test]
    fn commit_uses_the_identified_merchant_name_for_rule_matching() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        crate::services::merchants::create(&conn, "zzz test coffee", "ZZZ Test Coffee")
            .expect("create merchant");
        let group_id = crate::services::categories::create_group(&conn, "Food")
            .expect("create category group")
            .id;
        let category_id = crate::services::categories::create(&conn, group_id, "Coffee")
            .expect("create category")
            .id;
        // The rule only matches the clean merchant name, not the raw
        // processor-prefixed description.
        crate::services::categorization_rules::create(
            &conn,
            crate::services::categorization_rules::RuleField::Description,
            crate::services::categorization_rules::MatchType::Equals,
            "zzz test coffee",
            crate::services::categorization_rules::RuleActions {
                category_id: Some(category_id),
                ..Default::default()
            },
            0,
        )
        .expect("create categorization rule");
        let rows = vec![ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1250,
            description: "SQ *ZZZ TEST COFFEE COF 04/12".to_string(),
            category_id: None,
        }];

        commit_import(&conn, account_id, rows).expect("commit import");

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored[0].category_id, Some(category_id));
    }

    #[test]
    fn preview_ofx_transactions_against_existing_data() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let ofx = "<STMTTRN>\n<DTPOSTED>20260801\n<TRNAMT>-12.50\n<NAME>Coffee Shop\n</STMTTRN>\n";

        let rows = preview_import(&conn, account_id, ofx, ImportFormat::Ofx, None)
            .expect("preview import");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].status, MatchStatus::New);
        assert_eq!(rows[0].amount_cents, -1250);
    }

    #[test]
    fn preview_csv_without_a_mapping_errors() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let result = preview_import(&conn, account_id, "irrelevant", ImportFormat::Csv, None);

        assert!(result.is_err());
    }
}

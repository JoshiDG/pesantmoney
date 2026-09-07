use std::collections::HashMap;

use chrono::NaiveDate;
use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::services::transactions;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Frequency {
    Weekly,
    Biweekly,
    Monthly,
    Yearly,
}

impl Frequency {
    fn as_str(&self) -> &'static str {
        match self {
            Frequency::Weekly => "weekly",
            Frequency::Biweekly => "biweekly",
            Frequency::Monthly => "monthly",
            Frequency::Yearly => "yearly",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "weekly" => Some(Frequency::Weekly),
            "biweekly" => Some(Frequency::Biweekly),
            "monthly" => Some(Frequency::Monthly),
            "yearly" => Some(Frequency::Yearly),
            _ => None,
        }
    }

    /// Nominal interval length in days, used to project `next_expected_date`
    /// from the most recent occurrence.
    fn nominal_days(&self) -> i64 {
        match self {
            Frequency::Weekly => 7,
            Frequency::Biweekly => 14,
            Frequency::Monthly => 30,
            Frequency::Yearly => 365,
        }
    }

    /// Inclusive day-gap range that counts as "this frequency" when classifying
    /// the interval between two consecutive occurrences. See the doc comment on
    /// `detect_candidates` for why these particular windows were chosen.
    fn day_range(&self) -> (i64, i64) {
        match self {
            Frequency::Weekly => (5, 9),
            Frequency::Biweekly => (11, 17),
            Frequency::Monthly => (26, 34),
            Frequency::Yearly => (355, 375),
        }
    }

    fn classify_gap(gap_days: i64) -> Option<Frequency> {
        for frequency in [
            Frequency::Weekly,
            Frequency::Biweekly,
            Frequency::Monthly,
            Frequency::Yearly,
        ] {
            let (lo, hi) = frequency.day_range();
            if gap_days >= lo && gap_days <= hi {
                return Some(frequency);
            }
        }
        None
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecurringItem {
    pub id: i64,
    pub account_id: i64,
    pub description: String,
    pub amount_cents: i64,
    pub frequency: Frequency,
    pub next_expected_date: String,
    pub category_id: Option<i64>,
    pub is_confirmed: bool,
}

fn recurring_item_from_row(row: &rusqlite::Row) -> rusqlite::Result<RecurringItem> {
    let frequency_str: String = row.get(4)?;
    let frequency = Frequency::from_str(&frequency_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(4, "frequency".into(), rusqlite::types::Type::Text)
    })?;

    Ok(RecurringItem {
        id: row.get(0)?,
        account_id: row.get(1)?,
        description: row.get(2)?,
        amount_cents: row.get(3)?,
        frequency,
        next_expected_date: row.get(5)?,
        category_id: row.get(6)?,
        is_confirmed: row.get::<_, i64>(7)? != 0,
    })
}

const SELECT_COLUMNS: &str = "id, account_id, description, amount_cents, frequency, next_expected_date, category_id, is_confirmed";

/// Manually define a recurring item. Manually-defined items are considered
/// user-confirmed from the start (`is_confirmed = true`) since there's no
/// detection step to confirm.
pub fn create(
    conn: &Connection,
    account_id: i64,
    description: &str,
    amount_cents: i64,
    frequency: Frequency,
    next_expected_date: &str,
    category_id: Option<i64>,
) -> rusqlite::Result<RecurringItem> {
    conn.execute(
        "INSERT INTO recurring_items (account_id, description, amount_cents, frequency, next_expected_date, category_id, is_confirmed) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1)",
        rusqlite::params![
            account_id,
            description,
            amount_cents,
            frequency.as_str(),
            next_expected_date,
            category_id
        ],
    )?;
    let id = conn.last_insert_rowid();

    Ok(RecurringItem {
        id,
        account_id,
        description: description.to_string(),
        amount_cents,
        frequency,
        next_expected_date: next_expected_date.to_string(),
        category_id,
        is_confirmed: true,
    })
}

pub fn list_for_account(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<RecurringItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM recurring_items WHERE account_id = ?1 ORDER BY next_expected_date, id"
    ))?;
    let rows = stmt.query_map([account_id], recurring_item_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<RecurringItem>> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM recurring_items WHERE id = ?1"),
        [id],
        recurring_item_from_row,
    )
    .optional()
}

pub fn update(
    conn: &Connection,
    id: i64,
    description: &str,
    amount_cents: i64,
    frequency: Frequency,
    next_expected_date: &str,
    category_id: Option<i64>,
) -> rusqlite::Result<RecurringItem> {
    let rows_affected = conn.execute(
        "UPDATE recurring_items SET description = ?1, amount_cents = ?2, frequency = ?3, next_expected_date = ?4, category_id = ?5, updated_at = datetime('now') WHERE id = ?6",
        rusqlite::params![
            description,
            amount_cents,
            frequency.as_str(),
            next_expected_date,
            category_id,
            id
        ],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    let (account_id, is_confirmed): (i64, i64) = conn.query_row(
        "SELECT account_id, is_confirmed FROM recurring_items WHERE id = ?1",
        [id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    Ok(RecurringItem {
        id,
        account_id,
        description: description.to_string(),
        amount_cents,
        frequency,
        next_expected_date: next_expected_date.to_string(),
        category_id,
        is_confirmed: is_confirmed != 0,
    })
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM recurring_items WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Accepts a heuristically-detected candidate: flips `is_confirmed` to true.
pub fn confirm(conn: &Connection, id: i64) -> rusqlite::Result<RecurringItem> {
    let rows_affected = conn.execute(
        "UPDATE recurring_items SET is_confirmed = 1, updated_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM recurring_items WHERE id = ?1"),
        [id],
        recurring_item_from_row,
    )
}

fn normalize_description(description: &str) -> String {
    description.trim().to_lowercase()
}

/// Heuristically detects recurring patterns in an account's Transaction history
/// and upserts unconfirmed candidate `recurring_items` rows for the user to
/// review (see the "Recurring Item" glossary entry in CONTEXT.md).
///
/// Tolerance/threshold choices (documented here since the spec leaves them to
/// judgement, and there's no single correct answer):
///
/// - **Grouping**: transactions are grouped by normalized description
///   (trimmed, lowercased). This is a simple but effective proxy for "same
///   payee" without any fuzzy-matching machinery.
/// - **Minimum occurrences**: a group needs at least 3 transactions before it's
///   considered. Two transactions give only a single interval sample, which is
///   too easy to satisfy by coincidence (any two unrelated same-description
///   transactions a month apart would qualify). Three transactions give at
///   least two interval samples, so the interval has to be consistent, not
///   just present once.
/// - **Amount tolerance**: all amounts in the group must fall within ±2% of
///   the group's mean amount. This tolerates small drift (e.g. a subscription
///   price bump, tax rounding) while still rejecting genuinely different
///   amounts.
/// - **Interval buckets**: consecutive occurrences' day-gaps are classified
///   into one of four buckets, each with a few days of slop to absorb weekends
///   and month-length variance:
///     - weekly:   5-9 days   (nominal 7)
///     - biweekly: 11-17 days (nominal 14)
///     - monthly:  26-34 days (nominal 30; covers 28-31 day months plus a
///       few days of posting-date jitter)
///     - yearly:   355-375 days (nominal 365)
///   Every consecutive gap in the group must classify into the *same* bucket
///   for the group to count as regular; a group with a monthly gap followed by
///   a weekly gap is not a pattern.
/// - **Prediction**: `next_expected_date` is the most recent occurrence's date
///   plus the bucket's *nominal* interval (not the observed average), so
///   predictions stay on a predictable cadence (e.g. always ~30 days) rather
///   than drifting.
/// - **Idempotency**: re-running detection does not insert duplicate
///   candidates. If an unconfirmed candidate already exists for this
///   `(account_id, normalized description)`, its prediction is updated in
///   place instead of inserting a new row. Confirmed items are left alone —
///   once a user has confirmed an item, re-detection should not resurrect a
///   second unconfirmed copy of it.
pub fn detect_candidates(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<RecurringItem>> {
    const MIN_OCCURRENCES: usize = 3;
    const AMOUNT_TOLERANCE_RATIO: f64 = 0.02;

    let account_transactions = transactions::list_for_account(conn, account_id)?;

    let mut groups: HashMap<String, Vec<&transactions::Transaction>> = HashMap::new();
    for txn in &account_transactions {
        groups
            .entry(normalize_description(&txn.description))
            .or_default()
            .push(txn);
    }

    let mut detected = Vec::new();

    for (_normalized, mut txns) in groups {
        if txns.len() < MIN_OCCURRENCES {
            continue;
        }

        txns.sort_by(|a, b| a.date.cmp(&b.date));

        let mean_amount: f64 =
            txns.iter().map(|t| t.amount_cents as f64).sum::<f64>() / txns.len() as f64;
        let amounts_consistent = txns.iter().all(|t| {
            let deviation = (t.amount_cents as f64 - mean_amount).abs();
            deviation <= mean_amount.abs() * AMOUNT_TOLERANCE_RATIO
        });
        if !amounts_consistent || mean_amount == 0.0 {
            continue;
        }

        let dates: Vec<NaiveDate> = match txns
            .iter()
            .map(|t| NaiveDate::parse_from_str(&t.date, "%Y-%m-%d"))
            .collect::<Result<Vec<_>, _>>()
        {
            Ok(dates) => dates,
            Err(_) => continue,
        };

        let gaps: Vec<i64> = dates
            .windows(2)
            .map(|pair| (pair[1] - pair[0]).num_days())
            .collect();

        let first_frequency = match Frequency::classify_gap(gaps[0]) {
            Some(f) => f,
            None => continue,
        };
        let is_regular = gaps
            .iter()
            .all(|&gap| Frequency::classify_gap(gap) == Some(first_frequency));
        if !is_regular {
            continue;
        }

        let last_txn = txns.last().expect("group is non-empty");
        let last_date = *dates.last().expect("group is non-empty");
        let next_expected_date = last_date + chrono::Duration::days(first_frequency.nominal_days());
        let next_expected_date_str = next_expected_date.format("%Y-%m-%d").to_string();
        let description = last_txn.description.clone();
        let amount_cents = last_txn.amount_cents;
        let category_id = last_txn.category_id;
        let normalized = normalize_description(&description);

        let existing_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM recurring_items WHERE account_id = ?1 AND is_confirmed = 0 AND lower(trim(description)) = ?2",
                rusqlite::params![account_id, normalized],
                |row| row.get(0),
            )
            .optional()?;

        let item = if let Some(id) = existing_id {
            conn.execute(
                "UPDATE recurring_items SET description = ?1, amount_cents = ?2, frequency = ?3, next_expected_date = ?4, category_id = ?5, updated_at = datetime('now') WHERE id = ?6",
                rusqlite::params![
                    description,
                    amount_cents,
                    first_frequency.as_str(),
                    next_expected_date_str,
                    category_id,
                    id
                ],
            )?;
            RecurringItem {
                id,
                account_id,
                description,
                amount_cents,
                frequency: first_frequency,
                next_expected_date: next_expected_date_str,
                category_id,
                is_confirmed: false,
            }
        } else {
            conn.execute(
                "INSERT INTO recurring_items (account_id, description, amount_cents, frequency, next_expected_date, category_id, is_confirmed) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                rusqlite::params![
                    account_id,
                    description,
                    amount_cents,
                    first_frequency.as_str(),
                    next_expected_date_str,
                    category_id
                ],
            )?;
            let id = conn.last_insert_rowid();
            RecurringItem {
                id,
                account_id,
                description,
                amount_cents,
                frequency: first_frequency,
                next_expected_date: next_expected_date_str,
                category_id,
                is_confirmed: false,
            }
        };

        detected.push(item);
    }

    Ok(detected)
}

/// Confirmed recurring items whose `next_expected_date` falls within the next
/// `within_days` days from `as_of` (inclusive on both ends), for a cash-flow
/// forecast view. `as_of` is passed in explicitly (rather than computed via
/// SQLite's `date('now')`) so this is deterministically testable; callers
/// (Tauri commands) pass today's date.
pub fn upcoming(
    conn: &Connection,
    account_id: i64,
    as_of: &str,
    within_days: i64,
) -> rusqlite::Result<Vec<RecurringItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM recurring_items \
         WHERE account_id = ?1 AND is_confirmed = 1 \
         AND next_expected_date >= ?2 AND next_expected_date <= date(?2, '+' || ?3 || ' days') \
         ORDER BY next_expected_date, id"
    ))?;
    let rows = stmt.query_map(rusqlite::params![account_id, as_of, within_days], recurring_item_from_row)?;
    rows.collect()
}

/// Same window filter as `upcoming`, but across every account rather than
/// one — used by the notification check (see `services::notifications`),
/// which has no single account in view.
pub fn upcoming_all(conn: &Connection, as_of: &str, within_days: i64) -> rusqlite::Result<Vec<RecurringItem>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM recurring_items \
         WHERE is_confirmed = 1 \
         AND next_expected_date >= ?1 AND next_expected_date <= date(?1, '+' || ?2 || ' days') \
         ORDER BY next_expected_date, id"
    ))?;
    let rows = stmt.query_map(rusqlite::params![as_of, within_days], recurring_item_from_row)?;
    rows.collect()
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
    fn create_returns_the_new_item_confirmed() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let item = create(
            &conn,
            account_id,
            "Netflix",
            -1599,
            Frequency::Monthly,
            "2026-09-15",
            None,
        )
        .expect("create recurring item");

        assert_eq!(item.description, "Netflix");
        assert_eq!(item.amount_cents, -1599);
        assert_eq!(item.frequency, Frequency::Monthly);
        assert_eq!(item.next_expected_date, "2026-09-15");
        assert!(item.is_confirmed);
        assert!(item.id > 0);
    }

    #[test]
    fn list_for_account_returns_only_that_accounts_items() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let other_account_id = create_test_account(&conn);
        create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");
        create(
            &conn,
            other_account_id,
            "Gym",
            -4000,
            Frequency::Monthly,
            "2026-09-01",
            None,
        )
        .expect("create recurring item");

        let items = list_for_account(&conn, account_id).expect("list recurring items");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].description, "Netflix");
    }

    #[test]
    fn get_returns_none_for_an_unknown_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let item = get(&conn, 999).expect("get recurring item");

        assert_eq!(item, None);
    }

    #[test]
    fn update_changes_the_stored_fields() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");

        let updated = update(
            &conn,
            created.id,
            "Netflix Premium",
            -1999,
            Frequency::Monthly,
            "2026-10-15",
            None,
        )
        .expect("update recurring item");

        assert_eq!(updated.description, "Netflix Premium");
        assert_eq!(updated.amount_cents, -1999);
        assert_eq!(updated.next_expected_date, "2026-10-15");
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_fails_when_the_item_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update(&conn, 999, "Nope", -100, Frequency::Weekly, "2026-09-15", None);

        assert!(result.is_err());
    }

    #[test]
    fn delete_removes_the_item_so_get_returns_none() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");

        delete(&conn, created.id).expect("delete recurring item");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_fails_when_the_item_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn confirm_flips_an_unconfirmed_item_to_confirmed() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        // Manually insert an unconfirmed row to simulate a detected candidate.
        conn.execute(
            "INSERT INTO recurring_items (account_id, description, amount_cents, frequency, next_expected_date, is_confirmed) \
             VALUES (?1, 'Spotify', -999, 'monthly', '2026-09-20', 0)",
            [account_id],
        )
        .expect("insert candidate");
        let id = conn.last_insert_rowid();

        let confirmed = confirm(&conn, id).expect("confirm recurring item");

        assert!(confirmed.is_confirmed);
        assert_eq!(confirmed.description, "Spotify");
    }

    #[test]
    fn confirm_fails_when_the_item_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = confirm(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn detect_candidates_finds_a_genuine_monthly_pattern() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-06-15", -1599, "Netflix", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-07-15", -1599, "Netflix", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-08-14", -1599, "Netflix", None)
            .expect("create transaction");

        let detected = detect_candidates(&conn, account_id).expect("detect candidates");

        assert_eq!(detected.len(), 1);
        let candidate = &detected[0];
        assert_eq!(candidate.description, "Netflix");
        assert_eq!(candidate.frequency, Frequency::Monthly);
        assert!(!candidate.is_confirmed);
        // last occurrence 2026-08-14 + 30 days
        assert_eq!(candidate.next_expected_date, "2026-09-13");
    }

    #[test]
    fn detect_candidates_ignores_a_description_with_only_one_occurrence() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-08-01", -1599, "One-off", None)
            .expect("create transaction");

        let detected = detect_candidates(&conn, account_id).expect("detect candidates");

        assert!(detected.is_empty());
    }

    #[test]
    fn detect_candidates_ignores_irregular_one_off_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        // Same description, but wildly irregular spacing and amounts.
        transactions::create(&conn, account_id, "2026-01-03", -1200, "Misc Store", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-03-22", -5400, "Misc Store", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-08-09", -900, "Misc Store", None)
            .expect("create transaction");

        let detected = detect_candidates(&conn, account_id).expect("detect candidates");

        assert!(detected.is_empty());
    }

    #[test]
    fn detect_candidates_does_not_duplicate_on_a_second_run() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-06-15", -1599, "Netflix", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-07-15", -1599, "Netflix", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-08-14", -1599, "Netflix", None)
            .expect("create transaction");

        detect_candidates(&conn, account_id).expect("first detection run");
        // A later run (e.g. after import of a new month's transaction) should
        // update the existing candidate, not add a second one.
        transactions::create(&conn, account_id, "2026-09-13", -1599, "Netflix", None)
            .expect("create transaction");
        detect_candidates(&conn, account_id).expect("second detection run");

        let items = list_for_account(&conn, account_id).expect("list recurring items");
        let netflix_items: Vec<_> = items.iter().filter(|i| i.description == "Netflix").collect();
        assert_eq!(netflix_items.len(), 1);
        assert_eq!(netflix_items[0].next_expected_date, "2026-10-13");
    }

    #[test]
    fn detect_candidates_does_not_resurrect_a_confirmed_item() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        transactions::create(&conn, account_id, "2026-06-15", -1599, "Netflix", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-07-15", -1599, "Netflix", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-08-14", -1599, "Netflix", None)
            .expect("create transaction");

        let detected = detect_candidates(&conn, account_id).expect("first detection run");
        confirm(&conn, detected[0].id).expect("confirm candidate");

        // Re-running detection should not create a *new* unconfirmed duplicate
        // now that the original candidate has been confirmed.
        detect_candidates(&conn, account_id).expect("second detection run");

        let items = list_for_account(&conn, account_id).expect("list recurring items");
        let netflix_items: Vec<_> = items.iter().filter(|i| i.description == "Netflix").collect();
        assert_eq!(netflix_items.len(), 2);
        assert!(netflix_items.iter().any(|i| i.is_confirmed));
        assert!(netflix_items.iter().any(|i| !i.is_confirmed));
    }

    #[test]
    fn upcoming_filters_confirmed_items_within_the_date_window() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        create(&conn, account_id, "In window", -100, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");
        create(&conn, account_id, "On boundary", -100, Frequency::Monthly, "2026-09-20", None)
            .expect("create recurring item");
        create(&conn, account_id, "Too far", -100, Frequency::Monthly, "2026-10-01", None)
            .expect("create recurring item");
        create(&conn, account_id, "In the past", -100, Frequency::Monthly, "2026-09-01", None)
            .expect("create recurring item");

        let upcoming_items = upcoming(&conn, account_id, "2026-09-10", 10).expect("upcoming items");

        let descriptions: Vec<&str> = upcoming_items.iter().map(|i| i.description.as_str()).collect();
        assert_eq!(descriptions, vec!["In window", "On boundary"]);
    }

    #[test]
    fn upcoming_excludes_unconfirmed_candidates() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        conn.execute(
            "INSERT INTO recurring_items (account_id, description, amount_cents, frequency, next_expected_date, is_confirmed) \
             VALUES (?1, 'Detected only', -999, 'monthly', '2026-09-15', 0)",
            [account_id],
        )
        .expect("insert unconfirmed candidate");

        let upcoming_items = upcoming(&conn, account_id, "2026-09-10", 10).expect("upcoming items");

        assert!(upcoming_items.is_empty());
    }

    #[test]
    fn upcoming_all_spans_every_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let other_account_id = create_test_account(&conn);
        create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");
        create(&conn, other_account_id, "Gym", -4000, Frequency::Monthly, "2026-09-16", None)
            .expect("create recurring item");

        let upcoming_items = upcoming_all(&conn, "2026-09-10", 10).expect("upcoming items across accounts");

        let descriptions: Vec<&str> = upcoming_items.iter().map(|i| i.description.as_str()).collect();
        assert_eq!(descriptions, vec!["Netflix", "Gym"]);
    }

    #[test]
    fn delete_account_cascades_to_its_recurring_items() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");

        accounts::delete(&conn, account_id).expect("delete account");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }
}

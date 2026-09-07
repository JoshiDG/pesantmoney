use std::collections::HashSet;
use std::fmt;

use rusqlite::{params, Connection};
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::services::transactions::{self, Transaction};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transfer {
    pub id: i64,
    pub from_transaction_id: i64,
    pub to_transaction_id: i64,
    pub created_at: String,
}

/// Errors specific to linking two Transactions into a Transfer. Kept
/// separate from `rusqlite::Error` because these are domain validation
/// failures (bad input), not database failures — callers (and the Tauri
/// command layer) should be able to show the user a clear message rather
/// than a generic DB error.
#[derive(Debug)]
pub enum TransferError {
    TransactionNotFound(i64),
    SameTransaction,
    SameAccount,
    AmountMismatch,
    AlreadyLinked,
    NotFound(i64),
    Db(rusqlite::Error),
}

impl fmt::Display for TransferError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TransferError::TransactionNotFound(id) => {
                write!(f, "transaction {id} does not exist")
            }
            TransferError::SameTransaction => {
                write!(f, "cannot link a transaction to itself")
            }
            TransferError::SameAccount => {
                write!(f, "a transfer must link transactions on two different accounts")
            }
            TransferError::AmountMismatch => write!(
                f,
                "a transfer must link transactions whose amounts are exact opposites (one positive, one negative, equal magnitude)"
            ),
            TransferError::AlreadyLinked => {
                write!(f, "one of these transactions is already part of a transfer")
            }
            TransferError::NotFound(id) => write!(f, "transfer {id} does not exist"),
            TransferError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for TransferError {
    fn from(e: rusqlite::Error) -> Self {
        TransferError::Db(e)
    }
}

fn transfer_from_row(row: &rusqlite::Row) -> rusqlite::Result<Transfer> {
    Ok(Transfer {
        id: row.get(0)?,
        from_transaction_id: row.get(1)?,
        to_transaction_id: row.get(2)?,
        created_at: row.get(3)?,
    })
}

/// Links two existing Transactions into a Transfer. Validates that they sit
/// on two different Accounts and that their amounts are exact opposites
/// (one positive, one negative, equal magnitude) — the two halves of one
/// movement of money between the user's own Accounts. Also rejects linking
/// a Transaction that's already part of another Transfer.
pub fn link(
    conn: &Connection,
    from_transaction_id: i64,
    to_transaction_id: i64,
) -> Result<Transfer, TransferError> {
    if from_transaction_id == to_transaction_id {
        return Err(TransferError::SameTransaction);
    }

    let from = transactions::get(conn, from_transaction_id)?
        .ok_or(TransferError::TransactionNotFound(from_transaction_id))?;
    let to = transactions::get(conn, to_transaction_id)?
        .ok_or(TransferError::TransactionNotFound(to_transaction_id))?;

    if from.account_id == to.account_id {
        return Err(TransferError::SameAccount);
    }

    if from.amount_cents == 0 || from.amount_cents != -to.amount_cents {
        return Err(TransferError::AmountMismatch);
    }

    let already_linked: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM transfers WHERE from_transaction_id IN (?1, ?2) OR to_transaction_id IN (?1, ?2))",
        params![from_transaction_id, to_transaction_id],
        |row| row.get(0),
    )?;
    if already_linked {
        return Err(TransferError::AlreadyLinked);
    }

    conn.execute(
        "INSERT INTO transfers (from_transaction_id, to_transaction_id) VALUES (?1, ?2)",
        params![from_transaction_id, to_transaction_id],
    )?;
    let id = conn.last_insert_rowid();

    let created_at: String = conn.query_row(
        "SELECT created_at FROM transfers WHERE id = ?1",
        [id],
        |row| row.get(0),
    )?;

    Ok(Transfer {
        id,
        from_transaction_id,
        to_transaction_id,
        created_at,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Transfer>> {
    let mut stmt = conn.prepare(
        "SELECT id, from_transaction_id, to_transaction_id, created_at FROM transfers ORDER BY id",
    )?;
    let rows = stmt.query_map([], transfer_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Transfer>> {
    conn.query_row(
        "SELECT id, from_transaction_id, to_transaction_id, created_at FROM transfers WHERE id = ?1",
        [id],
        transfer_from_row,
    )
    .optional()
}

/// Deletes the Transfer link. Does NOT delete the underlying Transactions —
/// they go back to being ordinary income/expense once unlinked.
pub fn unlink(conn: &Connection, id: i64) -> Result<(), TransferError> {
    let rows_affected = conn.execute("DELETE FROM transfers WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(TransferError::NotFound(id));
    }
    Ok(())
}

fn linked_transaction_ids(conn: &Connection) -> rusqlite::Result<HashSet<i64>> {
    let mut stmt = conn.prepare("SELECT from_transaction_id, to_transaction_id FROM transfers")?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
    let mut ids = HashSet::new();
    for row in rows {
        let (from_id, to_id) = row?;
        ids.insert(from_id);
        ids.insert(to_id);
    }
    Ok(ids)
}

/// Converts an ISO "YYYY-MM-DD" date string into a Julian day number, so two
/// dates can be compared by simple subtraction without a date-time
/// dependency. Uses the standard proleptic-Gregorian civil-to-JDN formula.
fn day_number(date: &str) -> Option<i64> {
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: i64 = parts[0].parse().ok()?;
    let m: i64 = parts[1].parse().ok()?;
    let d: i64 = parts[2].parse().ok()?;

    let a = (14 - m) / 12;
    let y2 = y + 4800 - a;
    let m2 = m + 12 * a - 3;
    Some(d + (153 * m2 + 2) / 5 + 365 * y2 + y2 / 4 - y2 / 100 + y2 / 400 - 32045)
}

/// Suggests candidate Transfer pairs for `account_id`: unlinked Transactions
/// on this Account paired with unlinked Transactions on other Accounts whose
/// amount is the exact opposite and whose date is within 3 days.
///
/// Why exact amount match: a Transfer is one movement of money represented
/// twice, so the two postings should be exactly equal and opposite — any
/// difference means it's not (just) a Transfer (e.g. a fee was also
/// involved), and we'd rather under-suggest than mis-link.
///
/// Why +/-3 days: the two sides of a real-world transfer (e.g. a credit
/// card payment leaving checking and posting to the card) routinely land on
/// different calendar days because of bank processing/posting lag. Three
/// days comfortably covers typical ACH/statement posting delays without
/// opening the window so wide that unrelated same-amount transactions start
/// colliding.
pub fn suggest_matches(
    conn: &Connection,
    account_id: i64,
) -> rusqlite::Result<Vec<(Transaction, Transaction)>> {
    let linked_ids = linked_transaction_ids(conn)?;

    let account_txns: Vec<Transaction> = transactions::list_for_account(conn, account_id)?
        .into_iter()
        .filter(|t| !linked_ids.contains(&t.id))
        .collect();

    let other_txns: Vec<Transaction> = transactions::list_excluding_account(conn, account_id)?
        .into_iter()
        .filter(|t| !linked_ids.contains(&t.id))
        .collect();

    let mut matches = Vec::new();
    for a in &account_txns {
        for b in &other_txns {
            if a.amount_cents == 0 || a.amount_cents != -b.amount_cents {
                continue;
            }
            let (Some(day_a), Some(day_b)) = (day_number(&a.date), day_number(&b.date)) else {
                continue;
            };
            if (day_a - day_b).abs() <= 3 {
                matches.push((a.clone(), b.clone()));
            }
        }
    }

    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};

    fn create_test_account(conn: &Connection, name: &str) -> i64 {
        accounts::create(conn, name, AccountType::Checking, None)
            .expect("create account")
            .id
    }

    #[test]
    fn link_creates_a_transfer_for_two_opposite_amount_transactions_on_different_accounts() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        let out = transactions::create(&conn, checking_id, "2026-08-01", -5_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-01", 5_000, "Payment received", None)
            .expect("create transaction");

        let transfer = link(&conn, out.id, in_.id).expect("link transfer");

        assert_eq!(transfer.from_transaction_id, out.id);
        assert_eq!(transfer.to_transaction_id, in_.id);
        assert!(transfer.id > 0);
    }

    #[test]
    fn link_rejects_two_transactions_on_the_same_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, "Checking");
        let a = transactions::create(&conn, account_id, "2026-08-01", -1_000, "A", None)
            .expect("create transaction");
        let b = transactions::create(&conn, account_id, "2026-08-01", 1_000, "B", None)
            .expect("create transaction");

        let result = link(&conn, a.id, b.id);

        assert!(matches!(result, Err(TransferError::SameAccount)));
    }

    #[test]
    fn link_rejects_mismatched_amounts() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        let out = transactions::create(&conn, checking_id, "2026-08-01", -5_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-01", 4_999, "Payment received", None)
            .expect("create transaction");

        let result = link(&conn, out.id, in_.id);

        assert!(matches!(result, Err(TransferError::AmountMismatch)));
    }

    #[test]
    fn link_rejects_double_linking_a_transaction() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        let savings_id = create_test_account(&conn, "Savings");
        let out = transactions::create(&conn, checking_id, "2026-08-01", -5_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-01", 5_000, "Payment received", None)
            .expect("create transaction");
        let other = transactions::create(&conn, savings_id, "2026-08-01", -5_000, "Another", None)
            .expect("create transaction");
        link(&conn, out.id, in_.id).expect("link transfer");

        // Reusing `in_` (this time as the "from" side of a new pair) must
        // still be rejected — a transaction can only be in one transfer,
        // regardless of which role it plays.
        let result = link(&conn, in_.id, other.id);

        assert!(matches!(result, Err(TransferError::AlreadyLinked)));
    }

    #[test]
    fn unlink_removes_the_transfer_without_deleting_the_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        let out = transactions::create(&conn, checking_id, "2026-08-01", -5_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-01", 5_000, "Payment received", None)
            .expect("create transaction");
        let transfer = link(&conn, out.id, in_.id).expect("link transfer");

        unlink(&conn, transfer.id).expect("unlink transfer");

        assert_eq!(get(&conn, transfer.id).unwrap(), None);
        assert!(transactions::get(&conn, out.id).unwrap().is_some());
        assert!(transactions::get(&conn, in_.id).unwrap().is_some());
    }

    #[test]
    fn unlink_fails_when_the_transfer_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = unlink(&conn, 999);

        assert!(matches!(result, Err(TransferError::NotFound(999))));
    }

    #[test]
    fn suggest_matches_finds_a_genuine_pair_across_accounts_within_three_days() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        let out = transactions::create(&conn, checking_id, "2026-08-01", -5_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-03", 5_000, "Payment received", None)
            .expect("create transaction");

        let suggestions = suggest_matches(&conn, checking_id).expect("suggest matches");

        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].0.id, out.id);
        assert_eq!(suggestions[0].1.id, in_.id);
    }

    #[test]
    fn suggest_matches_ignores_already_linked_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        let out = transactions::create(&conn, checking_id, "2026-08-01", -5_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-01", 5_000, "Payment received", None)
            .expect("create transaction");
        link(&conn, out.id, in_.id).expect("link transfer");

        let suggestions = suggest_matches(&conn, checking_id).expect("suggest matches");

        assert!(suggestions.is_empty());
    }

    #[test]
    fn suggest_matches_ignores_non_matching_amounts_and_out_of_window_dates() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn, "Checking");
        let credit_card_id = create_test_account(&conn, "Credit Card");
        transactions::create(&conn, checking_id, "2026-08-01", -5_000, "Groceries", None)
            .expect("create transaction");
        // Wrong amount.
        transactions::create(&conn, credit_card_id, "2026-08-01", 4_000, "Unrelated", None)
            .expect("create transaction");
        // Right amount, but 10 days apart (outside the +/-3 day window).
        transactions::create(&conn, checking_id, "2026-08-05", -7_500, "Later payment", None)
            .expect("create transaction");
        transactions::create(&conn, credit_card_id, "2026-08-15", 7_500, "Too late", None)
            .expect("create transaction");

        let suggestions = suggest_matches(&conn, checking_id).expect("suggest matches");

        assert!(suggestions.is_empty());
    }
}

use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transaction {
    pub id: i64,
    pub account_id: i64,
    pub date: String,
    pub amount_cents: i64,
    pub description: String,
}

fn transaction_from_row(row: &rusqlite::Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: row.get(0)?,
        account_id: row.get(1)?,
        date: row.get(2)?,
        amount_cents: row.get(3)?,
        description: row.get(4)?,
    })
}

pub fn create(
    conn: &Connection,
    account_id: i64,
    date: &str,
    amount_cents: i64,
    description: &str,
) -> rusqlite::Result<Transaction> {
    conn.execute(
        "INSERT INTO transactions (account_id, date, amount_cents, description) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![account_id, date, amount_cents, description],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Transaction {
        id,
        account_id,
        date: date.to_string(),
        amount_cents,
        description: description.to_string(),
    })
}

pub fn list_for_account(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<Transaction>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, date, amount_cents, description FROM transactions \
         WHERE account_id = ?1 ORDER BY date, id",
    )?;
    let rows = stmt.query_map([account_id], transaction_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Transaction>> {
    conn.query_row(
        "SELECT id, account_id, date, amount_cents, description FROM transactions WHERE id = ?1",
        [id],
        transaction_from_row,
    )
    .optional()
}

pub fn update(
    conn: &Connection,
    id: i64,
    date: &str,
    amount_cents: i64,
    description: &str,
) -> rusqlite::Result<Transaction> {
    let rows_affected = conn.execute(
        "UPDATE transactions SET date = ?1, amount_cents = ?2, description = ?3, updated_at = datetime('now') WHERE id = ?4",
        rusqlite::params![date, amount_cents, description, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    let account_id: i64 = conn.query_row(
        "SELECT account_id FROM transactions WHERE id = ?1",
        [id],
        |row| row.get(0),
    )?;

    Ok(Transaction {
        id,
        account_id,
        date: date.to_string(),
        amount_cents,
        description: description.to_string(),
    })
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM transactions WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Sum of a single Account's Transaction amounts, in cents.
pub fn balance_cents(conn: &Connection, account_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions WHERE account_id = ?1",
        [account_id],
        |row| row.get(0),
    )
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
    fn create_returns_the_new_transaction_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let transaction = create(&conn, account_id, "2026-08-01", -1250, "Coffee shop")
            .expect("create transaction");

        assert_eq!(transaction.account_id, account_id);
        assert_eq!(transaction.date, "2026-08-01");
        assert_eq!(transaction.amount_cents, -1250);
        assert_eq!(transaction.description, "Coffee shop");
        assert!(transaction.id > 0);
    }

    #[test]
    fn list_for_account_returns_only_that_accounts_transactions_in_date_order() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let other_account_id = create_test_account(&conn);

        create(&conn, account_id, "2026-08-05", -500, "Later").expect("create transaction");
        create(&conn, account_id, "2026-08-01", -100, "Earlier").expect("create transaction");
        create(&conn, other_account_id, "2026-08-01", 100, "Other account")
            .expect("create transaction");

        let transactions = list_for_account(&conn, account_id).expect("list transactions");

        assert_eq!(transactions.len(), 2);
        assert_eq!(transactions[0].description, "Earlier");
        assert_eq!(transactions[1].description, "Later");
    }

    #[test]
    fn get_returns_none_for_an_unknown_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let transaction = get(&conn, 999).expect("get transaction");

        assert_eq!(transaction, None);
    }

    #[test]
    fn update_changes_the_stored_fields_and_returns_the_updated_transaction() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "2026-08-01", -100, "Old description")
            .expect("create transaction");

        let updated = update(&conn, created.id, "2026-08-02", -200, "New description")
            .expect("update transaction");

        assert_eq!(updated.date, "2026-08-02");
        assert_eq!(updated.amount_cents, -200);
        assert_eq!(updated.description, "New description");
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_fails_when_the_transaction_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update(&conn, 999, "2026-08-01", -100, "Nope");

        assert!(result.is_err());
    }

    #[test]
    fn delete_removes_the_transaction_so_get_returns_none() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created =
            create(&conn, account_id, "2026-08-01", -100, "Gone soon").expect("create transaction");

        delete(&conn, created.id).expect("delete transaction");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_fails_when_the_transaction_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn delete_account_cascades_to_its_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "2026-08-01", -100, "Cascades away")
            .expect("create transaction");

        accounts::delete(&conn, account_id).expect("delete account");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn balance_cents_sums_the_accounts_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        create(&conn, account_id, "2026-08-01", 100_000, "Paycheck").expect("create transaction");
        create(&conn, account_id, "2026-08-02", -2_500, "Groceries").expect("create transaction");

        let balance = balance_cents(&conn, account_id).expect("compute balance");

        assert_eq!(balance, 97_500);
    }

    #[test]
    fn balance_cents_is_zero_for_an_account_with_no_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let balance = balance_cents(&conn, account_id).expect("compute balance");

        assert_eq!(balance, 0);
    }
}

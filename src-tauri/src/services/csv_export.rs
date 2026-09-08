//! Portable CSV export of every Transaction, alongside the DB-file export in
//! `backup.rs`. Unlike that raw file copy, this is a human-readable format a
//! user could open in a spreadsheet or import into another tool.

use std::fs::File;
use std::io;
use std::path::Path;

use rusqlite::Connection;

/// One row of the CSV export: a Transaction joined with its Account and
/// (optional) Category names, since the raw ids in the `transactions` table
/// mean nothing outside this database.
struct ExportRow {
    account_name: String,
    date: String,
    description: String,
    category_name: Option<String>,
    amount_cents: i64,
}

fn amount_display(amount_cents: i64) -> String {
    let sign = if amount_cents < 0 { "-" } else { "" };
    let abs = amount_cents.abs();
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}

fn fetch_rows(conn: &Connection) -> rusqlite::Result<Vec<ExportRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.name, t.date, t.description, c.name, t.amount_cents \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         LEFT JOIN categories c ON c.id = t.category_id \
         ORDER BY t.date, t.id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ExportRow {
            account_name: row.get(0)?,
            date: row.get(1)?,
            description: row.get(2)?,
            category_name: row.get(3)?,
            amount_cents: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Writes every Transaction across every Account to `destination` as CSV
/// (Account, Date, Description, Category, Amount), returning the row count
/// written. A missing Category is left blank rather than omitted, matching
/// how uncategorized Transactions already render elsewhere in the app.
pub fn export_transactions_csv(conn: &Connection, destination: &Path) -> Result<usize, String> {
    let rows = fetch_rows(conn).map_err(|e| e.to_string())?;

    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e: io::Error| e.to_string())?;
        }
    }

    let file = File::create(destination).map_err(|e| e.to_string())?;
    let mut writer = csv::Writer::from_writer(file);
    writer
        .write_record(["Account", "Date", "Description", "Category", "Amount"])
        .map_err(|e| e.to_string())?;

    for row in &rows {
        writer
            .write_record([
                row.account_name.as_str(),
                row.date.as_str(),
                row.description.as_str(),
                row.category_name.as_deref().unwrap_or(""),
                &amount_display(row.amount_cents),
            ])
            .map_err(|e| e.to_string())?;
    }
    writer.flush().map_err(|e| e.to_string())?;

    Ok(rows.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};
    use crate::services::categories;
    use crate::services::transactions;

    #[test]
    fn writes_a_header_and_one_row_per_transaction_with_account_and_category_names() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account = accounts::create(&conn, "Everyday Checking", AccountType::Checking, None)
            .expect("create account");
        let group = categories::create_group(&conn, "Food").expect("create group");
        let category = categories::create(&conn, group.id, "Coffee").expect("create category");
        transactions::create(&conn, account.id, "2026-08-01", -1250, "Coffee Shop", Some(category.id))
            .expect("create transaction");
        transactions::create(&conn, account.id, "2026-08-02", 150_000, "Paycheck", None)
            .expect("create transaction");

        let dir = tempfile::tempdir().expect("tempdir");
        let destination = dir.path().join("export.csv");

        let count = export_transactions_csv(&conn, &destination).expect("export csv");

        assert_eq!(count, 2);
        let contents = std::fs::read_to_string(&destination).expect("read exported csv");
        let mut lines = contents.lines();
        assert_eq!(lines.next().unwrap(), "Account,Date,Description,Category,Amount");
        assert_eq!(lines.next().unwrap(), "Everyday Checking,2026-08-01,Coffee Shop,Coffee,-12.50");
        assert_eq!(lines.next().unwrap(), "Everyday Checking,2026-08-02,Paycheck,,1500.00");
    }

    #[test]
    fn writes_only_a_header_when_there_are_no_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let dir = tempfile::tempdir().expect("tempdir");
        let destination = dir.path().join("export.csv");

        let count = export_transactions_csv(&conn, &destination).expect("export csv");

        assert_eq!(count, 0);
        let contents = std::fs::read_to_string(&destination).expect("read exported csv");
        assert_eq!(contents.trim(), "Account,Date,Description,Category,Amount");
    }

    #[test]
    fn creates_missing_parent_directories_for_the_destination() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let dir = tempfile::tempdir().expect("tempdir");
        let destination = dir.path().join("nested").join("export.csv");

        export_transactions_csv(&conn, &destination).expect("export csv");

        assert!(destination.exists());
    }

    #[test]
    fn surfaces_an_error_instead_of_panicking_when_the_destination_cannot_be_created() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        // A destination whose parent is a file (not a directory) can never be
        // created — this should surface as an Err, not panic.
        let dir = tempfile::tempdir().expect("tempdir");
        let not_a_dir = dir.path().join("not-a-dir");
        std::fs::write(&not_a_dir, b"x").expect("write blocking file");
        let destination = not_a_dir.join("export.csv");

        let result = export_transactions_csv(&conn, &destination);

        assert!(result.is_err());
    }
}

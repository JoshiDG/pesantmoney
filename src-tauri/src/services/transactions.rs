use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transaction {
    pub id: i64,
    pub account_id: i64,
    pub date: String,
    pub amount_cents: i64,
    pub description: String,
    pub category_id: Option<i64>,
    /// Excluded from the default Transactions list and from all
    /// income/expense/budget/report totals -- same strength of exclusion as
    /// a linked Transfer, but an independent condition (see CONTEXT.md
    /// "Hidden", ADR-0014). Settable manually or via a Categorization Rule's
    /// hide action (issue #39).
    pub hidden: bool,
    /// The identified/assigned Merchant name: populated either at Import
    /// time from a Merchant-dictionary keyword match (`services::merchants`,
    /// issue #36) or by a Categorization Rule's rename action (issue #37).
    /// A derived display field, never a substitute for `description`: it
    /// must never be used for import-dedup fingerprinting, which depends on
    /// `description` staying exactly as imported. `None` means no
    /// match/rename has applied -- display `description` instead.
    pub merchant_name: Option<String>,
}

fn transaction_from_row(row: &rusqlite::Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: row.get(0)?,
        account_id: row.get(1)?,
        date: row.get(2)?,
        amount_cents: row.get(3)?,
        description: row.get(4)?,
        category_id: row.get(5)?,
        hidden: row.get(6)?,
        merchant_name: row.get(7)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, account_id, date, amount_cents, description, category_id, hidden, merchant_name";

/// A Transaction row carrying its Account's name alongside it, returned by
/// `list_all_with_accounts` for the all-Accounts Transactions view (#51) so
/// that screen can render an Account column/badge per row without a second
/// round-trip per Account.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TransactionWithAccount {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub date: String,
    pub amount_cents: i64,
    pub description: String,
    pub category_id: Option<i64>,
    pub hidden: bool,
    pub merchant_name: Option<String>,
}

fn transaction_with_account_from_row(row: &rusqlite::Row) -> rusqlite::Result<TransactionWithAccount> {
    Ok(TransactionWithAccount {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_name: row.get(2)?,
        date: row.get(3)?,
        amount_cents: row.get(4)?,
        description: row.get(5)?,
        category_id: row.get(6)?,
        hidden: row.get(7)?,
        merchant_name: row.get(8)?,
    })
}

pub fn create(
    conn: &Connection,
    account_id: i64,
    date: &str,
    amount_cents: i64,
    description: &str,
    category_id: Option<i64>,
) -> rusqlite::Result<Transaction> {
    conn.execute(
        "INSERT INTO transactions (account_id, date, amount_cents, description, category_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![account_id, date, amount_cents, description, category_id],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Transaction {
        id,
        account_id,
        date: date.to_string(),
        amount_cents,
        description: description.to_string(),
        category_id,
        hidden: false,
        merchant_name: None,
    })
}

pub fn list_for_account(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<Transaction>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM transactions WHERE account_id = ?1 ORDER BY date, id"
    ))?;
    let rows = stmt.query_map([account_id], transaction_from_row)?;
    rows.collect()
}

/// Like `list_for_account`, but for the default Transactions list view:
/// excludes hidden Transactions unless `include_hidden` is set (the "show
/// hidden" toggle -- issue #39).
pub fn list_visible_for_account(
    conn: &Connection,
    account_id: i64,
    include_hidden: bool,
) -> rusqlite::Result<Vec<Transaction>> {
    if include_hidden {
        return list_for_account(conn, account_id);
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM transactions WHERE account_id = ?1 AND hidden = 0 ORDER BY date, id"
    ))?;
    let rows = stmt.query_map([account_id], transaction_from_row)?;
    rows.collect()
}

/// All Transactions across every Account, each row carrying its Account's
/// name (`TransactionWithAccount`) so the all-Accounts Transactions view
/// (#51) can render an Account column/badge. Added alongside
/// `list_for_account`, not a replacement for it -- the Import flow and
/// per-Account balance display keep using the per-Account query unchanged
/// (see #49's "why all-Accounts queries alongside per-Account ones" note).
/// Unlike `list_visible_for_account`, this does not filter out hidden
/// Transactions -- that exclusion rule is Reports-specific (#49), not a
/// Transactions-view rule.
pub fn list_all_with_accounts(conn: &Connection) -> rusqlite::Result<Vec<TransactionWithAccount>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.account_id, a.name, t.date, t.amount_cents, t.description, \
                t.category_id, t.hidden, t.merchant_name \
         FROM transactions t \
         JOIN accounts a ON a.id = t.account_id \
         ORDER BY t.date, t.id",
    )?;
    let rows = stmt.query_map([], transaction_with_account_from_row)?;
    rows.collect()
}

/// Also used at runtime (not just in tests) by the transfers service, which
/// needs to fetch a Transaction's account and amount to validate a link.
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Transaction>> {
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM transactions WHERE id = ?1"),
        [id],
        transaction_from_row,
    )
    .optional()
}

/// All Transactions on Accounts other than `account_id`, for the transfers
/// service's cross-account match search.
pub fn list_excluding_account(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<Transaction>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM transactions WHERE account_id != ?1 ORDER BY date, id"
    ))?;
    let rows = stmt.query_map([account_id], transaction_from_row)?;
    rows.collect()
}

pub fn update(
    conn: &Connection,
    id: i64,
    date: &str,
    amount_cents: i64,
    description: &str,
    category_id: Option<i64>,
) -> rusqlite::Result<Transaction> {
    let rows_affected = conn.execute(
        "UPDATE transactions SET date = ?1, amount_cents = ?2, description = ?3, category_id = ?4, updated_at = datetime('now') WHERE id = ?5",
        rusqlite::params![date, amount_cents, description, category_id, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// Sets or clears the `hidden` flag on a single Transaction. Always
/// available regardless of how the Transaction came to be hidden (rule or
/// manual) -- unhiding is a plain, independently reversible action (ADR-0014).
pub fn set_hidden(conn: &Connection, id: i64, hidden: bool) -> rusqlite::Result<Transaction> {
    let rows_affected = conn.execute(
        "UPDATE transactions SET hidden = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![hidden, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
}

/// Sets (or clears, with `None`) the `merchant_name` display field. Never
/// touches `description`. Shared by Merchant-dictionary matching at Import
/// time (issue #36) and the Categorization Rule rename action (issue #37).
pub fn set_merchant_name(
    conn: &Connection,
    id: i64,
    merchant_name: Option<&str>,
) -> rusqlite::Result<Transaction> {
    let rows_affected = conn.execute(
        "UPDATE transactions SET merchant_name = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![merchant_name, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    get(conn, id)?.ok_or(rusqlite::Error::QueryReturnedNoRows)
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

/// Net change in a single Account's balance from Transactions dated within
/// `month` ("YYYY-MM") -- i.e. that month's contribution to `balance_cents`,
/// not the cumulative balance itself. Used by `services::goals` to build a
/// trailing-months average of realized progress for an account-linked
/// (debt) Goal's pace classification: paying down debt is a positive net
/// change per the same sign convention `balance_cents` and
/// `goals::progress_cents` already establish (payments recorded positive,
/// charges negative).
pub fn net_change_cents_for_month(conn: &Connection, account_id: i64, month: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions \
         WHERE account_id = ?1 AND substr(date, 1, 7) = ?2",
        rusqlite::params![account_id, month],
        |row| row.get(0),
    )
}

/// Sums income (positive amounts) and expense (negative amounts, reported as
/// a positive magnitude) across Transactions, excluding any Transaction that
/// is one half of a linked Transfer, OR that is `hidden`. A Transfer moves
/// money between two of the user's own Accounts (e.g. a credit card payment)
/// — no money entered or left the household, so it must not count as income
/// or expense even though it still affects each Account's own balance (see
/// `balance_cents`, which intentionally does NOT apply this exclusion). A
/// hidden Transaction (issue #39) is excluded for the same "don't count
/// this" reason, but independently -- a Transaction can be hidden without
/// being part of a Transfer, and vice versa (see ADR-0014).
///
/// `account_id`: `Some(id)` scopes the totals to one Account; `None` totals
/// across every Account.
pub fn income_expense_totals(
    conn: &Connection,
    account_id: Option<i64>,
) -> rusqlite::Result<(i64, i64)> {
    let base_sql = "SELECT \
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0), \
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) \
        FROM transactions t \
        WHERE t.hidden = 0 \
        AND t.id NOT IN ( \
            SELECT from_transaction_id FROM transfers \
            UNION \
            SELECT to_transaction_id FROM transfers \
        )";

    match account_id {
        Some(id) => conn.query_row(
            &format!("{base_sql} AND t.account_id = ?1"),
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
        None => conn.query_row(base_sql, [], |row| Ok((row.get(0)?, row.get(1)?))),
    }
}

/// Like `income_expense_totals`, but additionally scoped to Transactions
/// whose `date` falls within `[start_date, end_date]` (both inclusive, each
/// "YYYY-MM-DD"). Added rather than changing `income_expense_totals`'s
/// signature, since other code (e.g. the Budget screen's lifetime totals)
/// already calls that function without a date range. Reuses the same
/// linked-Transfer and `hidden` exclusions so a month's cash flow doesn't
/// count money moved between the user's own Accounts, or a hidden
/// Transaction, as income or expense.
pub fn income_expense_totals_for_range(
    conn: &Connection,
    account_id: Option<i64>,
    start_date: &str,
    end_date: &str,
) -> rusqlite::Result<(i64, i64)> {
    let base_sql = "SELECT \
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0), \
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) \
        FROM transactions t \
        WHERE t.date >= ?1 AND t.date <= ?2 \
        AND t.hidden = 0 \
        AND t.id NOT IN ( \
            SELECT from_transaction_id FROM transfers \
            UNION \
            SELECT to_transaction_id FROM transfers \
        )";

    match account_id {
        Some(id) => conn.query_row(
            &format!("{base_sql} AND t.account_id = ?3"),
            rusqlite::params![start_date, end_date, id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
        None => conn.query_row(base_sql, rusqlite::params![start_date, end_date], |row| {
            Ok((row.get(0)?, row.get(1)?))
        }),
    }
}

/// Like `income_expense_totals_for_range`, but bucketed by individual day
/// rather than summed across the whole range: one `(date, income_cents,
/// expense_cents)` row per calendar day from `start_date` to `end_date`
/// (both inclusive), including days with no Transactions at all (zeros), so
/// callers building a daily line chart don't need to separately track which
/// dates fall in the range. Reuses the same linked-Transfer and `hidden`
/// exclusions as `income_expense_totals_for_range`.
pub fn daily_income_expense_totals_for_range(
    conn: &Connection,
    account_id: Option<i64>,
    start_date: &str,
    end_date: &str,
) -> rusqlite::Result<Vec<(String, i64, i64)>> {
    let base_sql = "SELECT t.date, \
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0), \
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) \
        FROM transactions t \
        WHERE t.date >= ?1 AND t.date <= ?2 \
        AND t.hidden = 0 \
        AND t.id NOT IN ( \
            SELECT from_transaction_id FROM transfers \
            UNION \
            SELECT to_transaction_id FROM transfers \
        ) \
        GROUP BY t.date";

    let mut by_date: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();

    let rows: Vec<(String, i64, i64)> = match account_id {
        Some(id) => {
            let sql = "SELECT t.date, \
                    COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0), \
                    COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END), 0) \
                FROM transactions t \
                WHERE t.date >= ?1 AND t.date <= ?2 \
                AND t.hidden = 0 \
                AND t.id NOT IN ( \
                    SELECT from_transaction_id FROM transfers \
                    UNION \
                    SELECT to_transaction_id FROM transfers \
                ) \
                AND t.account_id = ?3 \
                GROUP BY t.date";
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt
                .query_map(rusqlite::params![start_date, end_date, id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        }
        None => {
            let mut stmt = conn.prepare(base_sql)?;
            let rows = stmt
                .query_map(rusqlite::params![start_date, end_date], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        }
    };

    for (date, income, expense) in rows {
        by_date.insert(date, (income, expense));
    }

    let parse_error = |field: &str| rusqlite::Error::InvalidParameterName(field.to_string());
    let mut current = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d")
        .map_err(|_| parse_error("start_date"))?;
    let end = chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d")
        .map_err(|_| parse_error("end_date"))?;

    let mut result = Vec::new();
    while current <= end {
        let date_str = current.format("%Y-%m-%d").to_string();
        let (income, expense) = by_date.get(&date_str).copied().unwrap_or((0, 0));
        result.push((date_str, income, expense));
        current += chrono::Duration::days(1);
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};
    use crate::services::transfers;

    fn create_test_account(conn: &Connection) -> i64 {
        accounts::create(conn, "Everyday Checking", AccountType::Checking, None)
            .expect("create account")
            .id
    }

    fn create_named_account(conn: &Connection, name: &str) -> i64 {
        accounts::create(conn, name, AccountType::Checking, None)
            .expect("create account")
            .id
    }

    #[test]
    fn create_returns_the_new_transaction_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let transaction = create(&conn, account_id, "2026-08-01", -1250, "Coffee shop", None)
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

        create(&conn, account_id, "2026-08-05", -500, "Later", None).expect("create transaction");
        create(&conn, account_id, "2026-08-01", -100, "Earlier", None).expect("create transaction");
        create(&conn, other_account_id, "2026-08-01", 100, "Other account", None)
            .expect("create transaction");

        let transactions = list_for_account(&conn, account_id).expect("list transactions");

        assert_eq!(transactions.len(), 2);
        assert_eq!(transactions[0].description, "Earlier");
        assert_eq!(transactions[1].description, "Later");
    }

    #[test]
    fn list_all_with_accounts_aggregates_across_every_account_with_account_names() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_named_account(&conn, "Everyday Checking");
        let savings_id = create_named_account(&conn, "Rainy Day Savings");

        create(&conn, checking_id, "2026-08-02", -1_500, "Groceries", None).expect("create transaction");
        create(&conn, savings_id, "2026-08-01", 10_000, "Transfer in", None).expect("create transaction");

        let rows = list_all_with_accounts(&conn).expect("list all transactions with accounts");

        assert_eq!(rows.len(), 2);
        // Ordered by date, id -- the savings deposit (earlier date) comes first.
        assert_eq!(rows[0].account_name, "Rainy Day Savings");
        assert_eq!(rows[0].description, "Transfer in");
        assert_eq!(rows[1].account_name, "Everyday Checking");
        assert_eq!(rows[1].description, "Groceries");
    }

    #[test]
    fn list_all_with_accounts_returns_an_empty_vec_when_there_are_no_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create_test_account(&conn);

        let rows = list_all_with_accounts(&conn).expect("list all transactions with accounts");

        assert_eq!(rows, Vec::new());
    }

    #[test]
    fn list_all_with_accounts_does_not_filter_out_hidden_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let hidden = create(&conn, account_id, "2026-08-01", -5_000, "Hidden expense", None)
            .expect("create transaction");
        set_hidden(&conn, hidden.id, true).expect("set hidden");

        let rows = list_all_with_accounts(&conn).expect("list all transactions with accounts");

        // Unlike Reports totals, the Transactions view (all-Accounts or
        // per-Account) does not exclude hidden Transactions by default.
        assert_eq!(rows.len(), 1);
        assert!(rows[0].hidden);
    }

    #[test]
    fn list_for_account_is_unaffected_by_the_new_all_accounts_query() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_named_account(&conn, "Checking");
        let savings_id = create_named_account(&conn, "Savings");
        create(&conn, checking_id, "2026-08-01", -100, "Checking only", None)
            .expect("create transaction");
        create(&conn, savings_id, "2026-08-01", 100, "Savings only", None)
            .expect("create transaction");

        let checking_transactions = list_for_account(&conn, checking_id).expect("list transactions");

        assert_eq!(checking_transactions.len(), 1);
        assert_eq!(checking_transactions[0].description, "Checking only");
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
        let created = create(&conn, account_id, "2026-08-01", -100, "Old description", None)
            .expect("create transaction");

        let updated = update(&conn, created.id, "2026-08-02", -200, "New description", None)
            .expect("update transaction");

        assert_eq!(updated.date, "2026-08-02");
        assert_eq!(updated.amount_cents, -200);
        assert_eq!(updated.description, "New description");
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_fails_when_the_transaction_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update(&conn, 999, "2026-08-01", -100, "Nope", None);

        assert!(result.is_err());
    }

    #[test]
    fn set_merchant_name_stores_it_without_changing_description() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "2026-08-01", -1250, "SQ *BLUE BOTTLE COF", None)
            .expect("create transaction");
        assert_eq!(created.merchant_name, None);

        set_merchant_name(&conn, created.id, Some("Blue Bottle Coffee")).expect("set merchant name");

        let stored = get(&conn, created.id).unwrap().unwrap();
        assert_eq!(stored.merchant_name, Some("Blue Bottle Coffee".to_string()));
        assert_eq!(stored.description, "SQ *BLUE BOTTLE COF");
    }

    #[test]
    fn delete_removes_the_transaction_so_get_returns_none() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created =
            create(&conn, account_id, "2026-08-01", -100, "Gone soon", None).expect("create transaction");

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
        let created = create(&conn, account_id, "2026-08-01", -100, "Cascades away", None)
            .expect("create transaction");

        accounts::delete(&conn, account_id).expect("delete account");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn balance_cents_sums_the_accounts_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        create(&conn, account_id, "2026-08-01", 100_000, "Paycheck", None).expect("create transaction");
        create(&conn, account_id, "2026-08-02", -2_500, "Groceries", None).expect("create transaction");

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

    #[test]
    fn create_and_update_persist_the_category_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let group_id = crate::services::categories::create_group(&conn, "Food")
            .expect("create category group")
            .id;
        let category_id = crate::services::categories::create(&conn, group_id, "Groceries")
            .expect("create category")
            .id;

        let created = create(
            &conn,
            account_id,
            "2026-08-01",
            -100,
            "Groceries run",
            Some(category_id),
        )
        .expect("create transaction");
        assert_eq!(created.category_id, Some(category_id));

        let other_category_id = crate::services::categories::create(&conn, group_id, "Restaurants")
            .expect("create category")
            .id;
        let updated = update(
            &conn,
            created.id,
            "2026-08-01",
            -100,
            "Groceries run",
            Some(other_category_id),
        )
        .expect("update transaction");

        assert_eq!(updated.category_id, Some(other_category_id));
    }

    #[test]
    fn deleting_a_category_clears_it_from_transactions_instead_of_failing() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let group_id = crate::services::categories::create_group(&conn, "Food")
            .expect("create category group")
            .id;
        let category_id = crate::services::categories::create(&conn, group_id, "Groceries")
            .expect("create category")
            .id;
        let created = create(
            &conn,
            account_id,
            "2026-08-01",
            -100,
            "Groceries run",
            Some(category_id),
        )
        .expect("create transaction");

        crate::services::categories::delete(&conn, category_id).expect("delete category");

        let after_delete = get(&conn, created.id).expect("get transaction").expect("transaction still exists");
        assert_eq!(after_delete.category_id, None);
    }

    #[test]
    fn income_expense_totals_excludes_a_linked_transfer_pair_but_includes_unlinked_transactions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let credit_card_id = create_test_account(&conn);

        // A genuine transfer: paying the credit card from checking.
        let out = create(&conn, checking_id, "2026-08-01", -50_000, "CC payment", None)
            .expect("create transaction");
        let in_ = create(&conn, credit_card_id, "2026-08-01", 50_000, "Payment received", None)
            .expect("create transaction");
        transfers::link(&conn, out.id, in_.id).expect("link transfer");

        // An unlinked transaction of the same shape (positive/negative pair
        // that happens to net to zero) must still be counted normally,
        // since only linked Transfers are excluded.
        create(&conn, checking_id, "2026-08-02", -2_500, "Groceries", None)
            .expect("create transaction");
        create(&conn, checking_id, "2026-08-03", 3_000, "Refund", None)
            .expect("create transaction");

        let (income, expense) = income_expense_totals(&conn, None).expect("compute totals");

        assert_eq!(income, 3_000);
        assert_eq!(expense, 2_500);
    }

    #[test]
    fn income_expense_totals_excludes_a_hidden_transaction_but_includes_unhidden_ones() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let hidden = create(&conn, account_id, "2026-08-01", -5_000, "Hidden expense", None)
            .expect("create transaction");
        set_hidden(&conn, hidden.id, true).expect("set hidden");
        create(&conn, account_id, "2026-08-02", -2_500, "Groceries", None).expect("create transaction");
        create(&conn, account_id, "2026-08-03", 3_000, "Refund", None).expect("create transaction");

        let (income, expense) = income_expense_totals(&conn, None).expect("compute totals");

        assert_eq!(income, 3_000);
        assert_eq!(expense, 2_500);
    }

    #[test]
    fn set_hidden_can_be_reversed() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "2026-08-01", -5_000, "Something", None)
            .expect("create transaction");

        set_hidden(&conn, created.id, true).expect("hide transaction");
        assert!(get(&conn, created.id).unwrap().unwrap().hidden);

        set_hidden(&conn, created.id, false).expect("unhide transaction");
        assert!(!get(&conn, created.id).unwrap().unwrap().hidden);
    }

    #[test]
    fn list_visible_for_account_excludes_hidden_unless_asked_for() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let visible = create(&conn, account_id, "2026-08-01", -1_000, "Visible", None)
            .expect("create transaction");
        let hidden = create(&conn, account_id, "2026-08-02", -2_000, "Hidden", None)
            .expect("create transaction");
        set_hidden(&conn, hidden.id, true).expect("hide transaction");

        let default_view =
            list_visible_for_account(&conn, account_id, false).expect("list visible transactions");
        let with_hidden =
            list_visible_for_account(&conn, account_id, true).expect("list all transactions");

        assert_eq!(default_view.iter().map(|t| t.id).collect::<Vec<_>>(), vec![visible.id]);
        assert_eq!(with_hidden.len(), 2);
    }

    #[test]
    fn set_merchant_name_does_not_touch_description() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let created = create(&conn, account_id, "2026-08-01", -1_250, "WHOLEFDS #4521", None)
            .expect("create transaction");

        let updated =
            set_merchant_name(&conn, created.id, Some("Whole Foods")).expect("set merchant name");

        assert_eq!(updated.merchant_name, Some("Whole Foods".to_string()));
        assert_eq!(updated.description, "WHOLEFDS #4521");
    }

    // Grid-editable Payee (#72, ADR-0019): a Payee edit sets `merchant_name`
    // on exactly the one Transaction being edited, even when another
    // Transaction shares the identical raw `description` -- the edit must
    // never retroactively rename anything else. Only the explicit, separate
    // "add to Merchant dictionary" confirmation path (services::merchants,
    // applied at a future Import) is allowed to affect other Transactions,
    // and even then only future ones, not existing rows like this second
    // Transaction.
    #[test]
    fn set_merchant_name_does_not_affect_other_transactions_with_identical_description() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let first = create(&conn, account_id, "2026-08-01", -1_250, "SQ *BLUE BOTTLE COF", None)
            .expect("create first transaction");
        let second = create(&conn, account_id, "2026-08-02", -1_400, "SQ *BLUE BOTTLE COF", None)
            .expect("create second transaction with identical description");

        set_merchant_name(&conn, first.id, Some("Blue Bottle Coffee")).expect("set merchant name");

        let first_after = get(&conn, first.id).unwrap().unwrap();
        let second_after = get(&conn, second.id).unwrap().unwrap();
        assert_eq!(first_after.merchant_name, Some("Blue Bottle Coffee".to_string()));
        assert_eq!(second_after.merchant_name, None);
        assert_eq!(second_after.description, "SQ *BLUE BOTTLE COF");
    }

    #[test]
    fn income_expense_totals_can_scope_to_a_single_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let savings_id = create_test_account(&conn);

        create(&conn, checking_id, "2026-08-01", -1_000, "Checking expense", None)
            .expect("create transaction");
        create(&conn, savings_id, "2026-08-01", 5_000, "Savings income", None)
            .expect("create transaction");

        let (income, expense) = income_expense_totals(&conn, Some(checking_id)).expect("compute totals");

        assert_eq!(income, 0);
        assert_eq!(expense, 1_000);
    }

    #[test]
    fn income_expense_totals_for_range_includes_only_dates_within_the_range() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        create(&conn, account_id, "2026-07-31", 10_000, "Before range", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-08-01", 5_000, "Start of range", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-08-15", -1_500, "Inside range", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-08-31", 2_000, "End of range", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-09-01", 50_000, "After range", None)
            .expect("create transaction");

        let (income, expense) =
            income_expense_totals_for_range(&conn, None, "2026-08-01", "2026-08-31")
                .expect("compute totals");

        assert_eq!(income, 7_000);
        assert_eq!(expense, 1_500);
    }

    #[test]
    fn income_expense_totals_for_range_excludes_a_linked_transfer_pair_within_range() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let credit_card_id = create_test_account(&conn);

        let out = create(&conn, checking_id, "2026-08-10", -50_000, "CC payment", None)
            .expect("create transaction");
        let in_ = create(&conn, credit_card_id, "2026-08-10", 50_000, "Payment received", None)
            .expect("create transaction");
        transfers::link(&conn, out.id, in_.id).expect("link transfer");

        create(&conn, checking_id, "2026-08-12", -2_500, "Groceries", None)
            .expect("create transaction");
        create(&conn, checking_id, "2026-08-13", 3_000, "Refund", None)
            .expect("create transaction");

        let (income, expense) =
            income_expense_totals_for_range(&conn, None, "2026-08-01", "2026-08-31")
                .expect("compute totals");

        assert_eq!(income, 3_000);
        assert_eq!(expense, 2_500);
    }

    #[test]
    fn income_expense_totals_for_range_can_scope_to_a_single_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let savings_id = create_test_account(&conn);

        create(&conn, checking_id, "2026-08-05", -1_000, "Checking expense", None)
            .expect("create transaction");
        create(&conn, savings_id, "2026-08-05", 5_000, "Savings income", None)
            .expect("create transaction");

        let (income, expense) =
            income_expense_totals_for_range(&conn, Some(checking_id), "2026-08-01", "2026-08-31")
                .expect("compute totals");

        assert_eq!(income, 0);
        assert_eq!(expense, 1_000);
    }

    #[test]
    fn daily_income_expense_totals_for_range_returns_one_row_per_day_including_empty_days() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        create(&conn, account_id, "2026-08-01", 5_000, "Paycheck", None)
            .expect("create transaction");

        let days = daily_income_expense_totals_for_range(&conn, None, "2026-08-01", "2026-08-03")
            .expect("compute daily totals");

        assert_eq!(
            days,
            vec![
                ("2026-08-01".to_string(), 5_000, 0),
                ("2026-08-02".to_string(), 0, 0),
                ("2026-08-03".to_string(), 0, 0),
            ]
        );
    }

    #[test]
    fn daily_income_expense_totals_for_range_buckets_multiple_transactions_on_the_same_day() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        create(&conn, account_id, "2026-08-01", 5_000, "Paycheck", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-08-01", -1_200, "Coffee", None)
            .expect("create transaction");

        let days = daily_income_expense_totals_for_range(&conn, None, "2026-08-01", "2026-08-01")
            .expect("compute daily totals");

        assert_eq!(days, vec![("2026-08-01".to_string(), 5_000, 1_200)]);
    }

    #[test]
    fn daily_income_expense_totals_for_range_excludes_dates_outside_the_range() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        create(&conn, account_id, "2026-07-31", 10_000, "Before range", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-08-01", 5_000, "In range", None)
            .expect("create transaction");
        create(&conn, account_id, "2026-08-02", 50_000, "After range", None)
            .expect("create transaction");

        let days = daily_income_expense_totals_for_range(&conn, None, "2026-08-01", "2026-08-01")
            .expect("compute daily totals");

        assert_eq!(days, vec![("2026-08-01".to_string(), 5_000, 0)]);
    }

    #[test]
    fn daily_income_expense_totals_for_range_excludes_a_linked_transfer_pair() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let credit_card_id = create_test_account(&conn);
        let out = create(&conn, checking_id, "2026-08-01", -50_000, "CC payment", None)
            .expect("create transaction");
        let in_ = create(&conn, credit_card_id, "2026-08-01", 50_000, "Payment received", None)
            .expect("create transaction");
        transfers::link(&conn, out.id, in_.id).expect("link transfer");

        let days = daily_income_expense_totals_for_range(&conn, None, "2026-08-01", "2026-08-01")
            .expect("compute daily totals");

        assert_eq!(days, vec![("2026-08-01".to_string(), 0, 0)]);
    }

    #[test]
    fn daily_income_expense_totals_for_range_can_scope_to_a_single_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let savings_id = create_test_account(&conn);
        create(&conn, checking_id, "2026-08-01", -1_000, "Checking expense", None)
            .expect("create transaction");
        create(&conn, savings_id, "2026-08-01", 5_000, "Savings income", None)
            .expect("create transaction");

        let days =
            daily_income_expense_totals_for_range(&conn, Some(checking_id), "2026-08-01", "2026-08-01")
                .expect("compute daily totals");

        assert_eq!(days, vec![("2026-08-01".to_string(), 0, 1_000)]);
    }
}

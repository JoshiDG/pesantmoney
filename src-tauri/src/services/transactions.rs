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
    /// The display name a Categorization Rule's rename action (issue #37)
    /// or, later, Merchant-dictionary matching (issue #36/ADR-0012) assigns
    /// to this Transaction. Never overwrites `description`, which must stay
    /// stable for import-dedup fingerprinting (ADR-0002). `None` means no
    /// rename/enrichment has applied -- display `description` instead.
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
/// touches `description`. Used by the Categorization Rule rename action
/// (issue #37) and available for a future Merchant-dictionary pass
/// (issue #36) to share the same field.
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
}

use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountType {
    Checking,
    Savings,
    CreditCard,
    Investment,
    Loan,
    Cash,
}

impl AccountType {
    fn as_str(&self) -> &'static str {
        match self {
            AccountType::Checking => "checking",
            AccountType::Savings => "savings",
            AccountType::CreditCard => "credit_card",
            AccountType::Investment => "investment",
            AccountType::Loan => "loan",
            AccountType::Cash => "cash",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "checking" => Some(AccountType::Checking),
            "savings" => Some(AccountType::Savings),
            "credit_card" => Some(AccountType::CreditCard),
            "investment" => Some(AccountType::Investment),
            "loan" => Some(AccountType::Loan),
            "cash" => Some(AccountType::Cash),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub account_type: AccountType,
    pub institution_name: Option<String>,
}

fn account_from_row(row: &rusqlite::Row) -> rusqlite::Result<Account> {
    let account_type_str: String = row.get(2)?;
    let account_type = AccountType::from_str(&account_type_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(2, "account_type".into(), rusqlite::types::Type::Text)
    })?;

    Ok(Account {
        id: row.get(0)?,
        name: row.get(1)?,
        account_type,
        institution_name: row.get(3)?,
    })
}

pub fn create(
    conn: &Connection,
    name: &str,
    account_type: AccountType,
    institution_name: Option<&str>,
) -> rusqlite::Result<Account> {
    conn.execute(
        "INSERT INTO accounts (name, account_type, institution_name) VALUES (?1, ?2, ?3)",
        rusqlite::params![name, account_type.as_str(), institution_name],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Account {
        id,
        name: name.to_string(),
        account_type,
        institution_name: institution_name.map(str::to_string),
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Account>> {
    let mut stmt =
        conn.prepare("SELECT id, name, account_type, institution_name FROM accounts ORDER BY id")?;
    let rows = stmt.query_map([], account_from_row)?;
    rows.collect()
}

/// Only exercised by tests today (verifying create/update/delete side effects);
/// not yet exposed as a Tauri command since the Accounts screen works off the
/// `list` result. Add a `get_account` command when a screen needs to fetch one.
#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Account>> {
    conn.query_row(
        "SELECT id, name, account_type, institution_name FROM accounts WHERE id = ?1",
        [id],
        account_from_row,
    )
    .optional()
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    account_type: AccountType,
    institution_name: Option<&str>,
) -> rusqlite::Result<Account> {
    let rows_affected = conn.execute(
        "UPDATE accounts SET name = ?1, account_type = ?2, institution_name = ?3, updated_at = datetime('now') WHERE id = ?4",
        rusqlite::params![name, account_type.as_str(), institution_name, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(Account {
        id,
        name: name.to_string(),
        account_type,
        institution_name: institution_name.map(str::to_string),
    })
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Net worth: the sum of `transactions::balance_cents` across every Account.
///
/// Sign convention (verified against `transactions::balance_cents` and
/// `transactions::income_expense_totals`, and the Transfer test fixture in
/// `services::transactions::tests`): `amount_cents` is NOT re-signed per
/// Account type anywhere in this codebase. A Transaction's amount is always
/// "the effect on that Account's own balance" — positive increases
/// `balance_cents`, negative decreases it — for every AccountType alike,
/// including CreditCard and Loan. The transfers-pair fixture makes this
/// concrete: paying down a credit card is `-50_000` on the checking Account
/// ("CC payment") and `+50_000` on the credit card Account ("Payment
/// received"). A payment *reduces debt*, and it is recorded as a *positive*
/// amount on the credit card Account — meaning a CreditCard Account's
/// `balance_cents` is already a signed liability figure: it runs negative as
/// charges (debt) accrue and moves back toward zero as payments are made.
/// That is exactly the sign a liability needs to contribute correctly to net
/// worth by plain addition. So checking/savings/cash/investment balances
/// (positive = asset) and credit_card/loan balances (negative when money is
/// owed) can simply be summed as-is — no per-AccountType sign-flipping is
/// needed or correct here. (Flipping credit_card/loan signs would double
/// the effect of debt already encoded as a negative balance, which is
/// exactly the bug this function must avoid.)
pub fn net_worth_cents(conn: &Connection) -> rusqlite::Result<i64> {
    let accounts = list(conn)?;
    let mut total = 0i64;
    for account in &accounts {
        total += crate::services::transactions::balance_cents(conn, account.id)?;
    }
    Ok(total)
}

/// Per-Account breakdown backing the net worth figure: every Account paired
/// with its own `balance_cents`, in the same order as `list` (by id).
pub fn net_worth_by_account(conn: &Connection) -> rusqlite::Result<Vec<(Account, i64)>> {
    let accounts = list(conn)?;
    accounts
        .into_iter()
        .map(|account| {
            let balance = crate::services::transactions::balance_cents(conn, account.id)?;
            Ok((account, balance))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn create_returns_the_new_account_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let account = create(&conn, "Everyday Checking", AccountType::Checking, Some("Ally Bank"))
            .expect("create account");

        assert_eq!(account.name, "Everyday Checking");
        assert_eq!(account.account_type, AccountType::Checking);
        assert_eq!(account.institution_name.as_deref(), Some("Ally Bank"));
        assert!(account.id > 0);
    }

    #[test]
    fn list_returns_all_created_accounts() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "Everyday Checking", AccountType::Checking, Some("Ally Bank"))
            .expect("create account");
        create(&conn, "Rainy Day Fund", AccountType::Savings, None).expect("create account");

        let accounts = list(&conn).expect("list accounts");

        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].name, "Everyday Checking");
        assert_eq!(accounts[1].name, "Rainy Day Fund");
        assert_eq!(accounts[1].institution_name, None);
    }

    #[test]
    fn get_returns_none_for_an_unknown_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let account = get(&conn, 999).expect("get account");

        assert_eq!(account, None);
    }

    #[test]
    fn update_changes_the_stored_fields_and_returns_the_updated_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let created = create(&conn, "Old Name", AccountType::Checking, None).expect("create account");

        let updated = update(
            &conn,
            created.id,
            "New Name",
            AccountType::Savings,
            Some("Chase"),
        )
        .expect("update account");

        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.account_type, AccountType::Savings);
        assert_eq!(updated.institution_name.as_deref(), Some("Chase"));
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn delete_removes_the_account_so_get_returns_none() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let created = create(&conn, "Old Wallet", AccountType::Cash, None).expect("create account");

        delete(&conn, created.id).expect("delete account");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn update_fails_when_the_account_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update(&conn, 999, "New Name", AccountType::Savings, None);

        assert!(result.is_err());
    }

    #[test]
    fn delete_fails_when_the_account_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn net_worth_cents_is_zero_with_no_accounts() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let net_worth = net_worth_cents(&conn).expect("compute net worth");

        assert_eq!(net_worth, 0);
    }

    #[test]
    fn net_worth_cents_sums_an_asset_and_a_liability_account_without_sign_flipping() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking = create(&conn, "Everyday Checking", AccountType::Checking, None)
            .expect("create account");
        let credit_card =
            create(&conn, "Rewards Card", AccountType::CreditCard, None).expect("create account");

        // Checking: paycheck in, a purchase out -> balance 80_000 (an asset).
        crate::services::transactions::create(&conn, checking.id, "2026-08-01", 100_000, "Paycheck", None)
            .expect("create transaction");
        crate::services::transactions::create(&conn, checking.id, "2026-08-02", -20_000, "Rent", None)
            .expect("create transaction");

        // Credit card: a charge (debt increases, recorded negative per the
        // sign convention documented on `net_worth_cents`) -> balance
        // -15_000 (a liability).
        crate::services::transactions::create(&conn, credit_card.id, "2026-08-03", -15_000, "Groceries", None)
            .expect("create transaction");

        let net_worth = net_worth_cents(&conn).expect("compute net worth");

        // 80_000 asset + (-15_000) liability = 65_000, the intuitively
        // correct net worth: what you own minus what you owe.
        assert_eq!(net_worth, 65_000);
    }

    #[test]
    fn net_worth_by_account_pairs_each_account_with_its_own_balance() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking = create(&conn, "Everyday Checking", AccountType::Checking, None)
            .expect("create account");
        let credit_card =
            create(&conn, "Rewards Card", AccountType::CreditCard, None).expect("create account");
        crate::services::transactions::create(&conn, checking.id, "2026-08-01", 50_000, "Paycheck", None)
            .expect("create transaction");
        crate::services::transactions::create(&conn, credit_card.id, "2026-08-02", -3_000, "Coffee", None)
            .expect("create transaction");

        let breakdown = net_worth_by_account(&conn).expect("compute breakdown");

        assert_eq!(breakdown.len(), 2);
        assert_eq!(breakdown[0].0.id, checking.id);
        assert_eq!(breakdown[0].1, 50_000);
        assert_eq!(breakdown[1].0.id, credit_card.id);
        assert_eq!(breakdown[1].1, -3_000);
    }
}

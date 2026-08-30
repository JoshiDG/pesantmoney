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
}

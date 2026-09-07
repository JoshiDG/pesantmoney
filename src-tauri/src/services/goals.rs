use std::fmt;

use rusqlite::{OptionalExtension, Connection};
use serde::Serialize;

use crate::services::budgets;
use crate::services::transactions;

/// A target dollar amount by a target date, linked to either a savings
/// Category (progress accrues from cumulative Assigned) or a debt Account
/// (progress accrues from balance paydown). Exactly one of
/// `linked_category_id` / `linked_account_id` is ever set -- enforced in
/// `create`, not in SQL (SQLite's CHECK support for cross-column XOR is
/// awkward, so the application layer owns this invariant).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Goal {
    pub id: i64,
    pub name: String,
    pub target_cents: i64,
    pub target_date: String,
    pub linked_category_id: Option<i64>,
    pub linked_account_id: Option<i64>,
    /// Only set (Some) for account-linked goals: the linked account's
    /// `balance_cents` at the moment the goal was created. None for
    /// category-linked goals, where progress is derived from Assigned
    /// instead and there is no "starting point" to snapshot.
    pub starting_balance_cents: Option<i64>,
}

/// A Goal plus its derived progress, for rendering the Goals screen in one
/// round trip.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GoalWithProgress {
    #[serde(flatten)]
    pub goal: Goal,
    pub progress_cents: i64,
}

/// Errors specific to Goal validation. Kept separate from `rusqlite::Error`
/// so the Tauri command layer can surface a clear message instead of a
/// generic DB error (see `services::transfers::TransferError` for the same
/// pattern).
#[derive(Debug)]
pub enum GoalError {
    MustLinkExactlyOne,
    CategoryNotFound(i64),
    AccountNotFound(i64),
    NotFound(i64),
    Db(rusqlite::Error),
}

impl fmt::Display for GoalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GoalError::MustLinkExactlyOne => write!(
                f,
                "a goal must link to exactly one of a savings category or a debt account, never both or neither"
            ),
            GoalError::CategoryNotFound(id) => write!(f, "category {id} does not exist"),
            GoalError::AccountNotFound(id) => write!(f, "account {id} does not exist"),
            GoalError::NotFound(id) => write!(f, "goal {id} does not exist"),
            GoalError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for GoalError {
    fn from(e: rusqlite::Error) -> Self {
        GoalError::Db(e)
    }
}

impl std::error::Error for GoalError {}

fn goal_from_row(row: &rusqlite::Row) -> rusqlite::Result<Goal> {
    Ok(Goal {
        id: row.get(0)?,
        name: row.get(1)?,
        target_cents: row.get(2)?,
        target_date: row.get(3)?,
        linked_category_id: row.get(4)?,
        linked_account_id: row.get(5)?,
        starting_balance_cents: row.get(6)?,
    })
}

const SELECT_GOAL: &str = "SELECT id, name, target_cents, target_date, linked_category_id, \
     linked_account_id, starting_balance_cents FROM goals";

/// Creates a Goal linked to exactly one of `linked_category_id` /
/// `linked_account_id` (a caller passing both or neither gets
/// `GoalError::MustLinkExactlyOne`). When linking to an account, the
/// account's current `balance_cents` is looked up and stored as
/// `starting_balance_cents` automatically -- the caller never passes it.
pub fn create(
    conn: &Connection,
    name: &str,
    target_cents: i64,
    target_date: &str,
    linked_category_id: Option<i64>,
    linked_account_id: Option<i64>,
) -> Result<Goal, GoalError> {
    let starting_balance_cents = match (linked_category_id, linked_account_id) {
        (Some(_), Some(_)) | (None, None) => return Err(GoalError::MustLinkExactlyOne),
        (Some(category_id), None) => {
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1)",
                [category_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(GoalError::CategoryNotFound(category_id));
            }
            None
        }
        (None, Some(account_id)) => {
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
                [account_id],
                |row| row.get(0),
            )?;
            if !exists {
                return Err(GoalError::AccountNotFound(account_id));
            }
            Some(transactions::balance_cents(conn, account_id)?)
        }
    };

    conn.execute(
        "INSERT INTO goals (name, target_cents, target_date, linked_category_id, linked_account_id, starting_balance_cents) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            name,
            target_cents,
            target_date,
            linked_category_id,
            linked_account_id,
            starting_balance_cents
        ],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Goal {
        id,
        name: name.to_string(),
        target_cents,
        target_date: target_date.to_string(),
        linked_category_id,
        linked_account_id,
        starting_balance_cents,
    })
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Goal>> {
    conn.query_row(
        &format!("{SELECT_GOAL} WHERE id = ?1"),
        [id],
        goal_from_row,
    )
    .optional()
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Goal>> {
    let mut stmt = conn.prepare(&format!("{SELECT_GOAL} ORDER BY id"))?;
    let rows = stmt.query_map([], goal_from_row)?;
    rows.collect()
}

/// Edits name/target_cents/target_date only. Deliberately does not allow
/// changing which category/account a Goal is linked to -- that's a
/// delete-and-recreate, which is simpler and avoids ambiguous
/// `starting_balance_cents` semantics (what would "re-linking" an
/// account-linked goal to a new account even mean for its starting point?).
pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    target_cents: i64,
    target_date: &str,
) -> Result<Goal, GoalError> {
    let rows_affected = conn.execute(
        "UPDATE goals SET name = ?1, target_cents = ?2, target_date = ?3, updated_at = datetime('now') WHERE id = ?4",
        rusqlite::params![name, target_cents, target_date, id],
    )?;
    if rows_affected == 0 {
        return Err(GoalError::NotFound(id));
    }

    get(conn, id)?.ok_or(GoalError::NotFound(id))
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), GoalError> {
    let rows_affected = conn.execute("DELETE FROM goals WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(GoalError::NotFound(id));
    }
    Ok(())
}

/// A Goal's progress in cents, as of today's data.
///
/// - Category-linked (savings) goal: cumulative Assigned to the linked
///   category through the current month (`budgets::cumulative_assigned_cents`
///   -- reused, not reimplemented). This is deliberately Assigned only, NOT
///   Assigned+Activity: a Goal tracks money put aside, not money left after
///   spending, whereas `category_available_cents` nets out Activity for the
///   Budget screen's different purpose. A savings-target category typically
///   has little/no spending against it anyway, but if it did, that spending
///   must not claw back Goal progress.
///
/// - Account-linked (debt) goal: `current_balance_cents - starting_balance_cents`.
///   Sign reasoning: `balance_cents` is a plain sum of the account's
///   Transaction amounts. For a debt account (credit card, loan) charges are
///   entered as negative amounts and payments as positive, so balance is
///   negative while debt is owed and rises toward (and potentially past)
///   zero as the debt is paid down. Paying down $600 of debt therefore makes
///   the balance $600 *more* (less negative), so `current - starting` is
///   positive exactly when progress was made, and negative if the debt grew
///   instead (e.g. starting -400, current -1000 -> -600: reported as-is,
///   not clamped, so the UI can show "over target" / negative progress
///   distinctly from "no progress yet" (0) rather than collapsing both to 0).
pub fn progress_cents(conn: &Connection, goal: &Goal) -> rusqlite::Result<i64> {
    if let Some(category_id) = goal.linked_category_id {
        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        return budgets::cumulative_assigned_cents(conn, category_id, &current_month);
    }

    if let Some(account_id) = goal.linked_account_id {
        let starting = goal.starting_balance_cents.unwrap_or(0);
        let current = transactions::balance_cents(conn, account_id)?;
        return Ok(current - starting);
    }

    // Unreachable in practice -- `create` enforces exactly one link -- but a
    // goal row can never be constructed with both links unset, so this is
    // just a safe default rather than a panic.
    Ok(0)
}

pub fn list_with_progress(conn: &Connection) -> rusqlite::Result<Vec<GoalWithProgress>> {
    list(conn)?
        .into_iter()
        .map(|goal| {
            let progress_cents = progress_cents(conn, &goal)?;
            Ok(GoalWithProgress { goal, progress_cents })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::{accounts, categories, transactions};
    use accounts::AccountType;

    fn create_test_category(conn: &Connection) -> i64 {
        let group_id = categories::create_group(conn, "Savings Goals").expect("create group").id;
        categories::create(conn, group_id, "Vacation Fund")
            .expect("create category")
            .id
    }

    fn create_test_account(conn: &Connection, account_type: AccountType) -> i64 {
        accounts::create(conn, "Test Account", account_type, None)
            .expect("create account")
            .id
    }

    #[test]
    fn create_rejects_both_links_set() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn, AccountType::CreditCard);

        let result = create(
            &conn,
            "Both",
            100_000,
            "2026-12-31",
            Some(category_id),
            Some(account_id),
        );

        assert!(matches!(result, Err(GoalError::MustLinkExactlyOne)));
    }

    #[test]
    fn create_rejects_neither_link_set() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = create(&conn, "Neither", 100_000, "2026-12-31", None, None);

        assert!(matches!(result, Err(GoalError::MustLinkExactlyOne)));
    }

    #[test]
    fn create_a_category_linked_goal_has_no_starting_balance() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);

        let goal = create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None)
            .expect("create goal");

        assert_eq!(goal.linked_category_id, Some(category_id));
        assert_eq!(goal.linked_account_id, None);
        assert_eq!(goal.starting_balance_cents, None);
        assert!(goal.id > 0);
    }

    #[test]
    fn create_an_account_linked_goal_snapshots_current_balance_automatically() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -5_000, "Charge", None)
            .expect("create transaction");

        let goal = create(&conn, "Pay off card", 5_000, "2026-12-31", None, Some(account_id))
            .expect("create goal");

        assert_eq!(goal.linked_account_id, Some(account_id));
        assert_eq!(goal.linked_category_id, None);
        assert_eq!(goal.starting_balance_cents, Some(-5_000));
    }

    #[test]
    fn create_fails_for_an_unknown_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = create(&conn, "Ghost", 100_000, "2026-12-31", Some(999), None);

        assert!(matches!(result, Err(GoalError::CategoryNotFound(999))));
    }

    #[test]
    fn create_fails_for_an_unknown_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = create(&conn, "Ghost", 100_000, "2026-12-31", None, Some(999));

        assert!(matches!(result, Err(GoalError::AccountNotFound(999))));
    }

    #[test]
    fn list_returns_all_created_goals() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None).expect("create goal");

        let goals = list(&conn).expect("list goals");

        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].name, "Vacation");
    }

    #[test]
    fn update_changes_name_target_and_date_but_not_the_link() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let created = create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None)
            .expect("create goal");

        let updated = update(&conn, created.id, "Big Vacation", 300_000, "2027-06-30").expect("update goal");

        assert_eq!(updated.name, "Big Vacation");
        assert_eq!(updated.target_cents, 300_000);
        assert_eq!(updated.target_date, "2027-06-30");
        assert_eq!(updated.linked_category_id, Some(category_id));
    }

    #[test]
    fn update_fails_when_the_goal_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update(&conn, 999, "Ghost", 1, "2026-01-01");

        assert!(matches!(result, Err(GoalError::NotFound(999))));
    }

    #[test]
    fn delete_removes_the_goal() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let created = create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None)
            .expect("create goal");

        delete(&conn, created.id).expect("delete goal");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_fails_when_the_goal_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999);

        assert!(matches!(result, Err(GoalError::NotFound(999))));
    }

    #[test]
    fn progress_cents_for_a_category_goal_is_cumulative_assigned_through_the_current_month() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let goal = create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None)
            .expect("create goal");

        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        budgets::assign(&conn, category_id, &current_month, 15_000).expect("assign budget");

        let progress = progress_cents(&conn, &goal).expect("compute progress");

        assert_eq!(progress, 15_000);
    }

    #[test]
    fn progress_cents_for_a_category_goal_ignores_spending_against_it() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn, AccountType::Checking);
        let goal = create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None)
            .expect("create goal");

        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        budgets::assign(&conn, category_id, &current_month, 15_000).expect("assign budget");
        // Spending FROM the savings category (e.g. booking part of the trip)
        // must not reduce progress -- the money was still put aside.
        transactions::create(&conn, account_id, &today, -3_000, "Booked flights", Some(category_id))
            .expect("create transaction");

        let progress = progress_cents(&conn, &goal).expect("compute progress");

        assert_eq!(progress, 15_000);
    }

    #[test]
    fn progress_cents_for_an_account_goal_is_positive_when_debt_is_paid_down() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -1_000, "Charge", None)
            .expect("create transaction");
        let goal = create(&conn, "Pay off card", 1_000, "2026-12-31", None, Some(account_id))
            .expect("create goal");

        // Pay down 600: balance moves from -1000 toward 0.
        transactions::create(&conn, account_id, "2026-02-01", 600, "Payment", None)
            .expect("create transaction");

        let progress = progress_cents(&conn, &goal).expect("compute progress");

        assert_eq!(progress, 600);
    }

    #[test]
    fn progress_cents_for_an_account_goal_is_negative_when_debt_grows_instead() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -400, "Charge", None)
            .expect("create transaction");
        let goal = create(&conn, "Pay off card", 1_000, "2026-12-31", None, Some(account_id))
            .expect("create goal");

        // Instead of paying it down, the user charges more: debt grows.
        transactions::create(&conn, account_id, "2026-02-01", -600, "More charges", None)
            .expect("create transaction");

        let progress = progress_cents(&conn, &goal).expect("compute progress");

        assert_eq!(progress, -600);
    }

    #[test]
    fn progress_cents_for_an_account_goal_is_zero_when_balance_is_unchanged() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -1_000, "Charge", None)
            .expect("create transaction");
        let goal = create(&conn, "Pay off card", 1_000, "2026-12-31", None, Some(account_id))
            .expect("create goal");

        let progress = progress_cents(&conn, &goal).expect("compute progress");

        assert_eq!(progress, 0);
    }

    #[test]
    fn list_with_progress_returns_one_entry_per_goal_with_progress_attached() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -1_000, "Charge", None)
            .expect("create transaction");

        create(&conn, "Vacation", 200_000, "2026-12-31", Some(category_id), None).expect("create goal");
        create(&conn, "Pay off card", 1_000, "2026-12-31", None, Some(account_id)).expect("create goal");

        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        budgets::assign(&conn, category_id, &current_month, 15_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-02-01", 400, "Payment", None)
            .expect("create transaction");

        let goals = list_with_progress(&conn).expect("list goals with progress");

        assert_eq!(goals.len(), 2);
        let vacation = goals.iter().find(|g| g.goal.name == "Vacation").unwrap();
        let card = goals.iter().find(|g| g.goal.name == "Pay off card").unwrap();
        assert_eq!(vacation.progress_cents, 15_000);
        assert_eq!(card.progress_cents, 400);
    }
}

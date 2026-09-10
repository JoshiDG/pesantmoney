use std::fmt;

use rusqlite::{OptionalExtension, Connection};
use serde::Serialize;

use crate::services::accounts;
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
    /// When the Goal was created, as SQLite's `datetime('now')` renders it
    /// ("YYYY-MM-DD HH:MM:SS"). Used only to gate `goal_pace`'s
    /// `InsufficientData` classification on whether 3 full calendar months
    /// have elapsed since creation -- never shown as a headline figure.
    pub created_at: String,
}

/// A Goal's on-track/ahead/behind pace classification -- see the "Goal Pace"
/// term in CONTEXT.md and ADR-0015. Derived entirely from existing
/// Assigned/Transaction history (via `goal_pace`), never from a
/// separately-entered contribution amount.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalPace {
    /// Fewer than 3 full calendar months have elapsed since the Goal was
    /// created -- too little history to extrapolate a pace from.
    InsufficientData,
    /// Trailing 3-month average pace is at least 110% of the pace required
    /// to hit the target by `target_date`.
    Ahead,
    /// Trailing 3-month average pace is within 90%-110% of the required
    /// pace, or the Goal has already met its target.
    OnTrack,
    /// Trailing 3-month average pace is below 90% of the required pace, or
    /// `target_date` has passed without the target being met.
    Behind,
}

/// A Goal plus its derived progress and pace, for rendering the Goals screen
/// in one round trip.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GoalWithProgress {
    #[serde(flatten)]
    pub goal: Goal,
    pub progress_cents: i64,
    pub pace: GoalPace,
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
        created_at: row.get(7)?,
    })
}

const SELECT_GOAL: &str = "SELECT id, name, target_cents, target_date, linked_category_id, \
     linked_account_id, starting_balance_cents, created_at FROM goals";

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

    // Re-fetch rather than constructing in-memory so `created_at` (a
    // DB-generated default) is populated correctly.
    get(conn, id)?.ok_or(GoalError::NotFound(id))
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
            let pace = goal_pace(conn, &goal, progress_cents)?;
            Ok(GoalWithProgress { goal, progress_cents, pace })
        })
        .collect()
}

/// The "YYYY-MM" month key from the front of a "YYYY-MM-DD..." date string
/// (works equally for a plain date and SQLite's `datetime('now')` output,
/// since both start with "YYYY-MM-DD").
fn month_key(date: &str) -> &str {
    &date[0..7]
}

fn split_year_month(month: &str) -> (i32, i32) {
    let year: i32 = month[0..4].parse().expect("valid 4-digit year in month key");
    let mon: i32 = month[5..7].parse().expect("valid 2-digit month in month key");
    (year, mon)
}

/// Whole-month distance from `from_month` to `to_month` (positive if `to`
/// is later, negative if earlier, 0 if the same month).
fn month_diff(from_month: &str, to_month: &str) -> i32 {
    let (from_year, from_mon) = split_year_month(from_month);
    let (to_year, to_mon) = split_year_month(to_month);
    (to_year * 12 + to_mon) - (from_year * 12 + from_mon)
}

/// Adds `delta` calendar months to a "YYYY-MM" key, wrapping the year as
/// needed. Mirrors `budgets::add_months` but kept local to this module since
/// pace math is the only caller here.
fn add_months_to_month(month: &str, delta: i32) -> String {
    let (year, mon) = split_year_month(month);
    let zero_based_total = year * 12 + (mon - 1) + delta;
    let new_year = zero_based_total.div_euclid(12);
    let new_month = zero_based_total.rem_euclid(12) + 1;
    format!("{new_year:04}-{new_month:02}")
}

/// The average of the realized incremental progress in each of the 3
/// calendar months immediately before `current_month` (i.e. NOT including
/// the current, still-in-progress month) -- the "actual pace" side of
/// `goal_pace`'s comparison. Category-linked goals use that month's
/// incremental Assigned; account-linked goals use that month's net balance
/// change, per the same sign convention `progress_cents` already
/// establishes (positive = progress toward the goal).
fn trailing_average_progress_cents(
    conn: &Connection,
    goal: &Goal,
    current_month: &str,
) -> rusqlite::Result<i64> {
    let mut total = 0i64;
    for months_back in 1..=3 {
        let month = add_months_to_month(current_month, -months_back);
        total += if let Some(category_id) = goal.linked_category_id {
            budgets::assigned_cents_for_month(conn, category_id, &month)?
        } else if let Some(account_id) = goal.linked_account_id {
            transactions::net_change_cents_for_month(conn, account_id, &month)?
        } else {
            0
        };
    }
    Ok(total / 3)
}

/// A Goal's on-track/ahead/behind pace, derived entirely from existing
/// progress data -- see the "Goal Pace" term in CONTEXT.md and ADR-0015.
///
/// Precedence, evaluated in order:
/// 1. Progress already meets or exceeds the target -> `OnTrack`, regardless
///    of `target_date` (a Goal met early is not "insufficient data" or
///    "behind").
/// 2. `target_date` has passed without the target being met -> `Behind`
///    (a hard deadline miss, not a pace comparison -- avoids the
///    ill-defined "infinite required pace" case).
/// 3. Fewer than 3 full calendar months have elapsed since the Goal was
///    created -> `InsufficientData` (do not extrapolate from 1-2 data
///    points).
/// 4. Otherwise, compare the trailing 3-month average actual pace against
///    the pace required to hit the target by `target_date`
///    (`(target - progress) / months_remaining`, `months_remaining` floored
///    at 1): >=110% required is `Ahead`, 90%-110% is `OnTrack`, <90% is
///    `Behind`.
pub fn goal_pace(conn: &Connection, goal: &Goal, progress_cents: i64) -> rusqlite::Result<GoalPace> {
    if progress_cents >= goal.target_cents {
        return Ok(GoalPace::OnTrack);
    }

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let current_month = month_key(&today).to_string();
    let target_month = month_key(&goal.target_date).to_string();

    if month_diff(&current_month, &target_month) < 0 {
        // target_date has already passed and the target was not met.
        return Ok(GoalPace::Behind);
    }

    let created_month = month_key(&goal.created_at).to_string();
    if month_diff(&created_month, &current_month) < 3 {
        return Ok(GoalPace::InsufficientData);
    }

    let months_remaining = month_diff(&current_month, &target_month).max(1);
    let required_pace_cents = (goal.target_cents - progress_cents) as f64 / months_remaining as f64;
    let actual_pace_cents = trailing_average_progress_cents(conn, goal, &current_month)? as f64;

    // required_pace_cents is guaranteed > 0 here: progress_cents < target_cents
    // was established above, and months_remaining is floored at 1.
    let ratio = actual_pace_cents / required_pace_cents;

    Ok(if ratio >= 1.10 {
        GoalPace::Ahead
    } else if ratio >= 0.90 {
        GoalPace::OnTrack
    } else {
        GoalPace::Behind
    })
}

/// The result of a single-Account debt payoff projection (see the "Payoff
/// Projection" term in CONTEXT.md and ADR-0016): either a finite number of
/// monthly payment periods and the resulting date, or an explicit signal
/// that the entered payment does not even cover accruing interest so no
/// finite payoff date exists.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PayoffProjection {
    Payoff { months: i64, payoff_date: String },
    WillNotPayOff,
}

/// Safety cap on the amortization loop in `project_payoff` (100 years of
/// monthly payments) so a payment that merely keeps pace with interest
/// (converging to payoff only in the limit) terminates as `WillNotPayOff`
/// instead of looping effectively forever.
const MAX_PAYOFF_MONTHS: i64 = 1_200;

/// Standard amortization: how many monthly payment periods until
/// `balance_owed_cents` (a positive amount owed) reaches zero, applying one
/// month of interest (`apr_bps / 12`) to the remaining balance before each
/// payment is applied. If `monthly_payment_cents` does not exceed the
/// interest accrued in a period, the balance never shrinks and no finite
/// payoff date exists.
///
/// `as_of_date` ("YYYY-MM-DD") is the date the projection counts forward
/// from (typically today) -- used only to compute a human `payoff_date`,
/// not the math itself.
pub fn project_payoff(
    balance_owed_cents: i64,
    apr_bps: i64,
    monthly_payment_cents: i64,
    as_of_date: &str,
) -> PayoffProjection {
    if balance_owed_cents <= 0 {
        return PayoffProjection::Payoff {
            months: 0,
            payoff_date: as_of_date.to_string(),
        };
    }

    let monthly_rate = apr_bps as f64 / 10_000.0 / 12.0;
    let mut remaining = balance_owed_cents as f64;
    let mut months = 0i64;

    loop {
        let interest = remaining * monthly_rate;
        if monthly_payment_cents as f64 <= interest {
            return PayoffProjection::WillNotPayOff;
        }
        remaining = remaining + interest - monthly_payment_cents as f64;
        months += 1;
        if remaining <= 0.0 {
            break;
        }
        if months >= MAX_PAYOFF_MONTHS {
            return PayoffProjection::WillNotPayOff;
        }
    }

    PayoffProjection::Payoff {
        months,
        payoff_date: add_months_to_date(as_of_date, months),
    }
}

/// Adds `months` calendar months to a "YYYY-MM-DD" date, clamping the day
/// downward if the target month is shorter (e.g. Jan 31 + 1 month -> Feb 28).
fn add_months_to_date(date: &str, months: i64) -> String {
    use chrono::{Datelike, NaiveDate};

    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .unwrap_or_else(|_| NaiveDate::from_ymd_opt(1970, 1, 1).expect("valid fallback date"));

    let zero_based_total = parsed.year() * 12 + (parsed.month() as i32 - 1) + months as i32;
    let year = zero_based_total.div_euclid(12);
    let month = (zero_based_total.rem_euclid(12) + 1) as u32;

    for day in (1..=parsed.day()).rev() {
        if let Some(date) = NaiveDate::from_ymd_opt(year, month, day) {
            return date.format("%Y-%m-%d").to_string();
        }
    }
    // Unreachable in practice (day 1 is always valid), but keep a safe
    // fallback rather than panicking.
    format!("{year:04}-{month:02}-01")
}

/// Errors specific to the debt payoff projection lookup, kept separate from
/// `GoalError` since this is Account-centric, not Goal-centric (a Payoff
/// Projection is a what-if calculator, not tied to any particular Goal --
/// see CONTEXT.md).
#[derive(Debug)]
pub enum PayoffError {
    AccountNotFound(i64),
    AprNotSet(i64),
    Db(rusqlite::Error),
}

impl fmt::Display for PayoffError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PayoffError::AccountNotFound(id) => write!(f, "account {id} does not exist"),
            PayoffError::AprNotSet(id) => {
                write!(f, "account {id} has no APR set -- cannot project a payoff date")
            }
            PayoffError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for PayoffError {
    fn from(e: rusqlite::Error) -> Self {
        PayoffError::Db(e)
    }
}

impl std::error::Error for PayoffError {}

/// Looks up a debt Account's current balance and APR, then projects a
/// payoff date for a hypothetical `monthly_payment_cents`. The hypothetical
/// payment is never persisted (not written to Transactions, Assigned
/// amounts, or any Goal field) -- this is a recompute-on-demand what-if
/// calculator, and it does not touch `Goal::progress_cents`.
pub fn project_account_payoff(
    conn: &Connection,
    account_id: i64,
    monthly_payment_cents: i64,
) -> Result<PayoffProjection, PayoffError> {
    let account = accounts::get(conn, account_id)?.ok_or(PayoffError::AccountNotFound(account_id))?;
    let apr_bps = account.apr_bps.ok_or(PayoffError::AprNotSet(account_id))?;
    // `balance_cents` is negative while debt is owed (see the sign
    // convention documented on `progress_cents` and `accounts::net_worth_cents`);
    // a positive or zero balance means no debt is owed, so there's nothing to
    // project.
    let balance = transactions::balance_cents(conn, account_id)?;
    let balance_owed_cents = (-balance).max(0);
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    Ok(project_payoff(balance_owed_cents, apr_bps, monthly_payment_cents, &today))
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

    /// Backdates a Goal's `created_at` by `months_ago` calendar months (via
    /// SQLite's own datetime modifiers, so it stays consistent with however
    /// the DB actually renders "now"), then re-fetches it so callers get a
    /// `Goal` whose `created_at` reflects the change.
    fn backdate_goal(conn: &Connection, goal_id: i64, months_ago: i64) -> Goal {
        conn.execute(
            &format!("UPDATE goals SET created_at = datetime('now', '-{months_ago} months') WHERE id = ?1"),
            [goal_id],
        )
        .expect("backdate goal");
        get(conn, goal_id).expect("get goal").expect("goal exists")
    }

    #[test]
    fn goal_pace_is_insufficient_data_for_a_brand_new_goal() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let goal = create(&conn, "Vacation", 200_000, "2030-12-31", Some(category_id), None)
            .expect("create goal");

        let pace = goal_pace(&conn, &goal, 0).expect("compute pace");

        assert_eq!(pace, GoalPace::InsufficientData);
    }

    #[test]
    fn goal_pace_is_on_track_when_progress_already_meets_the_target() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let goal = create(&conn, "Vacation", 200_000, "2030-12-31", Some(category_id), None)
            .expect("create goal");

        // Met (or exceeded) early: on track regardless of target_date or
        // history length.
        let pace = goal_pace(&conn, &goal, 250_000).expect("compute pace");

        assert_eq!(pace, GoalPace::OnTrack);
    }

    #[test]
    fn goal_pace_is_behind_when_target_date_has_passed_without_meeting_the_target() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let goal = create(&conn, "Vacation", 200_000, "2020-01-01", Some(category_id), None)
            .expect("create goal");

        let pace = goal_pace(&conn, &goal, 50_000).expect("compute pace");

        assert_eq!(pace, GoalPace::Behind);
    }

    #[test]
    fn goal_pace_is_ahead_when_trailing_pace_comfortably_exceeds_the_required_pace() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        // Target 3 months out, so months_remaining = 3.
        let target_date = format!("{}-01", add_months_to_month(&current_month, 3));
        let goal = create(&conn, "Vacation", 60_000, &target_date, Some(category_id), None)
            .expect("create goal");
        let goal = backdate_goal(&conn, goal.id, 3);

        // 11,000/month assigned in each of the 3 trailing months -> progress
        // 33,000, required pace (60,000 - 33,000) / 3 = 9,000/month, actual
        // 11,000/month -> ratio 1.222, comfortably >= 1.10.
        for months_back in 1..=3 {
            let month = add_months_to_month(&current_month, -months_back);
            budgets::assign(&conn, category_id, &month, 11_000).expect("assign budget");
        }
        let progress = progress_cents(&conn, &goal).expect("compute progress");

        let pace = goal_pace(&conn, &goal, progress).expect("compute pace");

        assert_eq!(progress, 33_000);
        assert_eq!(pace, GoalPace::Ahead);
    }

    #[test]
    fn goal_pace_is_on_track_when_trailing_pace_matches_the_required_pace() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        let target_date = format!("{}-01", add_months_to_month(&current_month, 3));
        let goal = create(&conn, "Vacation", 60_000, &target_date, Some(category_id), None)
            .expect("create goal");
        let goal = backdate_goal(&conn, goal.id, 3);

        // 10,000/month -> progress 30,000, required (60,000-30,000)/3 =
        // 10,000/month, actual 10,000/month -> ratio exactly 1.0.
        for months_back in 1..=3 {
            let month = add_months_to_month(&current_month, -months_back);
            budgets::assign(&conn, category_id, &month, 10_000).expect("assign budget");
        }
        let progress = progress_cents(&conn, &goal).expect("compute progress");

        let pace = goal_pace(&conn, &goal, progress).expect("compute pace");

        assert_eq!(pace, GoalPace::OnTrack);
    }

    #[test]
    fn goal_pace_is_behind_when_trailing_pace_falls_short_of_the_required_pace() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        let target_date = format!("{}-01", add_months_to_month(&current_month, 3));
        let goal = create(&conn, "Vacation", 60_000, &target_date, Some(category_id), None)
            .expect("create goal");
        let goal = backdate_goal(&conn, goal.id, 3);

        // 8,000/month -> progress 24,000, required (60,000-24,000)/3 =
        // 12,000/month, actual 8,000/month -> ratio 0.667, well below 0.90.
        for months_back in 1..=3 {
            let month = add_months_to_month(&current_month, -months_back);
            budgets::assign(&conn, category_id, &month, 8_000).expect("assign budget");
        }
        let progress = progress_cents(&conn, &goal).expect("compute progress");

        let pace = goal_pace(&conn, &goal, progress).expect("compute pace");

        assert_eq!(pace, GoalPace::Behind);
    }

    #[test]
    fn goal_pace_uses_net_balance_change_for_an_account_linked_goal() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2020-01-01", -60_000, "Charge", None)
            .expect("create transaction");
        let current_month = chrono::Local::now().format("%Y-%m").to_string();
        let target_date = format!("{}-01", add_months_to_month(&current_month, 3));
        let goal = create(&conn, "Pay off card", 60_000, &target_date, None, Some(account_id))
            .expect("create goal");
        let goal = backdate_goal(&conn, goal.id, 3);

        // Pay down 11,000/month for the trailing 3 months -> same shape as
        // the category-linked "ahead" case above.
        for months_back in 1..=3 {
            let month = add_months_to_month(&current_month, -months_back);
            let date = format!("{month}-15");
            transactions::create(&conn, account_id, &date, 11_000, "Payment", None)
                .expect("create transaction");
        }
        let progress = progress_cents(&conn, &goal).expect("compute progress");

        let pace = goal_pace(&conn, &goal, progress).expect("compute pace");

        assert_eq!(progress, 33_000);
        assert_eq!(pace, GoalPace::Ahead);
    }

    #[test]
    fn project_payoff_matches_a_hand_computed_amortization_example() {
        // $5,000 balance, 20% APR, $200/month payment.
        let projection = project_payoff(500_000, 2_000, 20_000, "2026-01-01");

        match projection {
            PayoffProjection::Payoff { months, payoff_date } => {
                assert_eq!(months, 33);
                assert_eq!(payoff_date, "2028-10-01");
            }
            PayoffProjection::WillNotPayOff => panic!("expected a finite payoff"),
        }
    }

    #[test]
    fn project_payoff_reports_will_not_pay_off_when_payment_does_not_exceed_interest() {
        // $5,000 balance at 20% APR accrues ~$83.33/month in interest; an
        // $80/month payment never touches principal.
        let projection = project_payoff(500_000, 2_000, 8_000, "2026-01-01");

        assert_eq!(projection, PayoffProjection::WillNotPayOff);
    }

    #[test]
    fn project_payoff_reports_will_not_pay_off_when_payment_exactly_equals_interest() {
        // The boundary case: a payment that exactly covers interest never
        // reduces principal either.
        let projection = project_payoff(500_000, 2_000, 8_333, "2026-01-01");

        assert_eq!(projection, PayoffProjection::WillNotPayOff);
    }

    #[test]
    fn project_payoff_is_immediate_for_a_zero_or_negative_balance() {
        let projection = project_payoff(0, 2_000, 20_000, "2026-01-01");

        assert_eq!(
            projection,
            PayoffProjection::Payoff {
                months: 0,
                payoff_date: "2026-01-01".to_string()
            }
        );
    }

    #[test]
    fn project_payoff_handles_a_zero_apr_as_straight_division() {
        // No interest: balance shrinks by exactly the payment each month.
        let projection = project_payoff(10_000, 0, 2_500, "2026-01-01");

        assert_eq!(
            projection,
            PayoffProjection::Payoff {
                months: 4,
                payoff_date: "2026-05-01".to_string()
            }
        );
    }

    #[test]
    fn project_account_payoff_fails_when_the_account_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = project_account_payoff(&conn, 999, 20_000);

        assert!(matches!(result, Err(PayoffError::AccountNotFound(999))));
    }

    #[test]
    fn project_account_payoff_fails_when_no_apr_is_set() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -500_000, "Charge", None)
            .expect("create transaction");

        let result = project_account_payoff(&conn, account_id, 20_000);

        assert!(matches!(result, Err(PayoffError::AprNotSet(id)) if id == account_id));
    }

    #[test]
    fn project_account_payoff_uses_the_accounts_balance_and_apr() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -500_000, "Charge", None)
            .expect("create transaction");
        accounts::set_apr(&conn, account_id, Some(2_000)).expect("set apr");

        let projection = project_account_payoff(&conn, account_id, 20_000).expect("project payoff");

        match projection {
            PayoffProjection::Payoff { months, .. } => assert_eq!(months, 33),
            PayoffProjection::WillNotPayOff => panic!("expected a finite payoff"),
        }
    }

    #[test]
    fn project_account_payoff_does_not_change_goal_progress_semantics() {
        // Guardrail for the acceptance criterion that the payoff projection
        // must never touch Goal::progress_cents / balance-paydown logic.
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn, AccountType::CreditCard);
        transactions::create(&conn, account_id, "2026-01-01", -500_000, "Charge", None)
            .expect("create transaction");
        accounts::set_apr(&conn, account_id, Some(2_000)).expect("set apr");
        let goal = create(&conn, "Pay off card", 500_000, "2030-12-31", None, Some(account_id))
            .expect("create goal");

        let progress_before = progress_cents(&conn, &goal).expect("compute progress");
        project_account_payoff(&conn, account_id, 20_000).expect("project payoff");
        let progress_after = progress_cents(&conn, &goal).expect("compute progress");

        assert_eq!(progress_before, progress_after);
    }
}

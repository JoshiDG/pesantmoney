use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// A user's decision to move `assigned_cents` from Ready to Assign into
/// `category_id` for one calendar `month` ("YYYY-MM"). Unique per
/// (category_id, month) — assigning again for the same category+month
/// updates the existing row rather than creating a second one.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BudgetAssignment {
    pub id: i64,
    pub category_id: i64,
    pub month: String,
    pub assigned_cents: i64,
}

/// One row of the Budget screen: a Category (with its Group, so the UI can
/// section the table) plus its Assigned/Activity/Available for one month.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CategoryBudgetLine {
    pub category_id: i64,
    pub category_name: String,
    pub group_id: i64,
    pub group_name: String,
    pub assigned_cents: i64,
    pub activity_cents: i64,
    pub available_cents: i64,
}

fn budget_assignment_from_row(row: &rusqlite::Row) -> rusqlite::Result<BudgetAssignment> {
    Ok(BudgetAssignment {
        id: row.get(0)?,
        category_id: row.get(1)?,
        month: row.get(2)?,
        assigned_cents: row.get(3)?,
    })
}

/// Adds `delta` calendar months to a "YYYY-MM" string, wrapping the year as
/// needed (e.g. "2026-01" + (-1) => "2025-12"). Used to walk month-by-month
/// when computing rollover.
fn add_months(month: &str, delta: i32) -> String {
    let year: i32 = month[0..4].parse().expect("valid 4-digit year in month key");
    let mon: i32 = month[5..7].parse().expect("valid 2-digit month in month key");
    let zero_based_total = year * 12 + (mon - 1) + delta;
    let new_year = zero_based_total.div_euclid(12);
    let new_month = zero_based_total.rem_euclid(12) + 1;
    format!("{new_year:04}-{new_month:02}")
}

/// Upserts the Assigned amount for one Category in one month: creates the
/// assignment if it doesn't exist yet, otherwise overwrites the existing
/// amount (never accumulates two rows for the same category+month).
pub fn assign(
    conn: &Connection,
    category_id: i64,
    month: &str,
    assigned_cents: i64,
) -> rusqlite::Result<BudgetAssignment> {
    conn.execute(
        "INSERT INTO budget_assignments (category_id, month, assigned_cents) VALUES (?1, ?2, ?3)
         ON CONFLICT (category_id, month)
         DO UPDATE SET assigned_cents = excluded.assigned_cents, updated_at = datetime('now')",
        rusqlite::params![category_id, month, assigned_cents],
    )?;

    conn.query_row(
        "SELECT id, category_id, month, assigned_cents FROM budget_assignments \
         WHERE category_id = ?1 AND month = ?2",
        rusqlite::params![category_id, month],
        budget_assignment_from_row,
    )
}

/// The Assigned amount recorded for a Category in exactly one month, or 0 if
/// none was ever recorded for that month.
fn assigned_cents_for_month(conn: &Connection, category_id: i64, month: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT assigned_cents FROM budget_assignments WHERE category_id = ?1 AND month = ?2",
        rusqlite::params![category_id, month],
        |row| row.get(0),
    )
    .optional()
    .map(|opt| opt.unwrap_or(0))
}

/// Sum of a Category's Transaction amounts whose date falls within `month`
/// ("YYYY-MM"). Typically negative (spending); positive for refunds/income
/// posted directly to the category.
pub fn category_activity_cents(conn: &Connection, category_id: i64, month: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions \
         WHERE category_id = ?1 AND substr(date, 1, 7) = ?2",
        rusqlite::params![category_id, month],
        |row| row.get(0),
    )
}

/// The earliest month ("YYYY-MM") in which a Category has either an
/// Assignment or Transaction activity, or None if the category has never
/// been touched by either.
fn earliest_month_for_category(conn: &Connection, category_id: i64) -> rusqlite::Result<Option<String>> {
    let earliest_assignment: Option<String> = conn
        .query_row(
            "SELECT MIN(month) FROM budget_assignments WHERE category_id = ?1",
            [category_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();

    let earliest_activity: Option<String> = conn
        .query_row(
            "SELECT MIN(substr(date, 1, 7)) FROM transactions WHERE category_id = ?1",
            [category_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();

    Ok(match (earliest_assignment, earliest_activity) {
        (Some(a), Some(b)) => Some(std::cmp::min(a, b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    })
}

/// Cumulative Assigned to a Category across every month through `month`
/// (inclusive), ignoring Activity entirely. This is the reusable piece a
/// savings-linked Goal's progress is built from (see `services::goals`): a
/// Goal tracks money that was *put aside*, not money left after spending, so
/// unlike `category_available_cents` it must NOT net out Activity — a
/// category that's a savings target typically has little/no spending against
/// it anyway, but if it did, spending shouldn't claw back Goal progress.
pub fn cumulative_assigned_cents(conn: &Connection, category_id: i64, month: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(assigned_cents), 0) FROM budget_assignments \
         WHERE category_id = ?1 AND month <= ?2",
        rusqlite::params![category_id, month],
        |row| row.get(0),
    )
}

/// A Category's Available balance going into `month`: this month's Assigned
/// plus this month's Activity, plus whatever Available carried forward from
/// the prior month. This is intentionally cumulative/recursive (rollover):
/// unspent Assigned in one month is still spendable the next, and — the
/// correct YNAB behavior — a NEGATIVE Available (overspending) also carries
/// forward as a debt against the next month rather than resetting to zero.
/// A category with no Assignments or Activity ever returns 0, never errors.
///
/// Implemented iteratively (not truly recursively) by walking every month
/// from the category's first-ever activity up to the target month and
/// accumulating Assigned + Activity per month, which avoids unbounded
/// recursion for categories with a long history.
pub fn category_available_cents(conn: &Connection, category_id: i64, month: &str) -> rusqlite::Result<i64> {
    let Some(start_month) = earliest_month_for_category(conn, category_id)? else {
        return Ok(0);
    };

    if start_month.as_str() > month {
        return Ok(0);
    }

    let mut running = 0i64;
    let mut cursor = start_month;
    loop {
        running += assigned_cents_for_month(conn, category_id, &cursor)?;
        running += category_activity_cents(conn, category_id, &cursor)?;
        if cursor == month {
            break;
        }
        cursor = add_months(&cursor, 1);
    }

    Ok(running)
}

/// Ready to Assign for `month`: cumulative income received through `month`
/// minus cumulative Assigned across every category through `month`.
///
/// Exact formula:
///   ready_to_assign(month) = SUM(amount_cents) over all Transactions with
///     amount_cents > 0 AND date's "YYYY-MM" <= month
///   MINUS SUM(assigned_cents) over all budget_assignments with
///     month <= month
///
/// This is YNAB's cumulative model ("money you have minus money you've
/// assigned, ever"), not a monthly reset: assigning money in March still
/// reduces Ready to Assign in April if it wasn't un-assigned. "Income" here
/// is deliberately not tied to the seeded "Income" category group by name —
/// any Transaction with a positive amount counts as income, so the figure
/// stays correct even if the user renames/deletes that group or logs income
/// (refunds, paychecks, interest) under any category.
pub fn ready_to_assign_cents(conn: &Connection, month: &str) -> rusqlite::Result<i64> {
    let total_income: i64 = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM transactions \
         WHERE amount_cents > 0 AND substr(date, 1, 7) <= ?1",
        [month],
        |row| row.get(0),
    )?;

    let total_assigned: i64 = conn.query_row(
        "SELECT COALESCE(SUM(assigned_cents), 0) FROM budget_assignments WHERE month <= ?1",
        [month],
        |row| row.get(0),
    )?;

    Ok(total_income - total_assigned)
}

/// One row per Category (joined with its Category Group) with its
/// Assigned/Activity/Available for `month`, for rendering the whole Budget
/// screen in a single call.
pub fn list_budget_for_month(conn: &Connection, month: &str) -> rusqlite::Result<Vec<CategoryBudgetLine>> {
    let mut stmt = conn.prepare(
        "SELECT categories.id, categories.name, category_groups.id, category_groups.name \
         FROM categories \
         JOIN category_groups ON category_groups.id = categories.group_id \
         ORDER BY category_groups.id, categories.id",
    )?;
    let categories: Vec<(i64, String, i64, String)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    categories
        .into_iter()
        .map(|(category_id, category_name, group_id, group_name)| {
            Ok(CategoryBudgetLine {
                category_id,
                category_name,
                group_id,
                group_name,
                assigned_cents: assigned_cents_for_month(conn, category_id, month)?,
                activity_cents: category_activity_cents(conn, category_id, month)?,
                available_cents: category_available_cents(conn, category_id, month)?,
            })
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
        let group_id = categories::create_group(conn, "Food").expect("create group").id;
        categories::create(conn, group_id, "Groceries")
            .expect("create category")
            .id
    }

    fn create_test_account(conn: &Connection) -> i64 {
        accounts::create(conn, "Checking", AccountType::Checking, None)
            .expect("create account")
            .id
    }

    #[test]
    fn add_months_wraps_year_backward() {
        assert_eq!(add_months("2026-01", -1), "2025-12");
    }

    #[test]
    fn add_months_wraps_year_forward() {
        assert_eq!(add_months("2025-12", 1), "2026-01");
    }

    #[test]
    fn add_months_handles_within_year() {
        assert_eq!(add_months("2026-06", 1), "2026-07");
        assert_eq!(add_months("2026-06", -1), "2026-05");
    }

    #[test]
    fn assign_creates_a_new_assignment() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);

        let assignment = assign(&conn, category_id, "2026-03", 10_000).expect("assign budget");

        assert_eq!(assignment.category_id, category_id);
        assert_eq!(assignment.month, "2026-03");
        assert_eq!(assignment.assigned_cents, 10_000);
        assert!(assignment.id > 0);
    }

    #[test]
    fn assign_again_for_the_same_category_and_month_updates_instead_of_duplicating() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);

        let first = assign(&conn, category_id, "2026-03", 10_000).expect("assign budget");
        let second = assign(&conn, category_id, "2026-03", 15_000).expect("re-assign budget");

        assert_eq!(first.id, second.id);
        assert_eq!(second.assigned_cents, 15_000);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM budget_assignments WHERE category_id = ?1 AND month = ?2",
                rusqlite::params![category_id, "2026-03"],
                |row| row.get(0),
            )
            .expect("count assignments");
        assert_eq!(count, 1);
    }

    #[test]
    fn category_activity_cents_sums_only_that_categorys_transactions_in_the_month() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let other_category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-03-05", -2_000, "Groceries", Some(category_id))
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-03-20", -1_500, "More groceries", Some(category_id))
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-03-06", -900, "Other category", Some(other_category_id))
            .expect("create transaction");

        let activity = category_activity_cents(&conn, category_id, "2026-03").expect("compute activity");

        assert_eq!(activity, -3_500);
    }

    #[test]
    fn category_activity_cents_respects_the_month_boundary() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-02-28", -1_000, "February", Some(category_id))
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-03-01", -2_000, "March", Some(category_id))
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-04-01", -4_000, "April", Some(category_id))
            .expect("create transaction");

        let march_activity = category_activity_cents(&conn, category_id, "2026-03").expect("compute activity");

        assert_eq!(march_activity, -2_000);
    }

    #[test]
    fn category_available_cents_is_zero_for_a_category_with_no_history() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);

        let available = category_available_cents(&conn, category_id, "2026-03").expect("compute available");

        assert_eq!(available, 0);
    }

    #[test]
    fn category_available_cents_is_assigned_plus_activity_in_the_first_month() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        assign(&conn, category_id, "2026-03", 10_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-03-05", -4_000, "Groceries", Some(category_id))
            .expect("create transaction");

        let available = category_available_cents(&conn, category_id, "2026-03").expect("compute available");

        assert_eq!(available, 6_000);
    }

    #[test]
    fn category_available_cents_carries_a_positive_leftover_into_the_next_month() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        // March: assign 10000, spend 4000 -> leftover 6000.
        assign(&conn, category_id, "2026-03", 10_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-03-05", -4_000, "Groceries", Some(category_id))
            .expect("create transaction");

        // April: assign nothing new, spend 1000.
        transactions::create(&conn, account_id, "2026-04-02", -1_000, "Groceries", Some(category_id))
            .expect("create transaction");

        let april_available = category_available_cents(&conn, category_id, "2026-04").expect("compute available");

        // 6000 carried forward - 1000 spent = 5000.
        assert_eq!(april_available, 5_000);
    }

    #[test]
    fn category_available_cents_carries_a_negative_overspend_forward_as_debt() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        // March: assign 1000, spend 3000 -> overspent by 2000.
        assign(&conn, category_id, "2026-03", 1_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-03-05", -3_000, "Overspend", Some(category_id))
            .expect("create transaction");

        // April: assign 2500 to cover the debt, no spending.
        assign(&conn, category_id, "2026-04", 2_500).expect("assign budget");

        let march_available = category_available_cents(&conn, category_id, "2026-03").expect("compute available");
        let april_available = category_available_cents(&conn, category_id, "2026-04").expect("compute available");

        assert_eq!(march_available, -2_000);
        // -2000 carried forward + 2500 assigned = 500.
        assert_eq!(april_available, 500);
    }

    #[test]
    fn category_available_cents_handles_a_year_boundary_rollover() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);

        assign(&conn, category_id, "2025-12", 5_000).expect("assign budget");

        let january_available = category_available_cents(&conn, category_id, "2026-01").expect("compute available");

        assert_eq!(january_available, 5_000);
    }

    #[test]
    fn cumulative_assigned_cents_sums_assignments_through_the_month_ignoring_activity() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        assign(&conn, category_id, "2026-01", 5_000).expect("assign budget");
        assign(&conn, category_id, "2026-02", 3_000).expect("assign budget");
        // Spending should NOT reduce cumulative assigned -- only Activity does
        // that for `category_available_cents`, but a Goal cares about money
        // put aside, not money left after spending.
        transactions::create(&conn, account_id, "2026-02-10", -1_000, "Spent", Some(category_id))
            .expect("create transaction");
        // A later assignment (March) must not count toward February's total.
        assign(&conn, category_id, "2026-03", 10_000).expect("assign budget");

        let cumulative = cumulative_assigned_cents(&conn, category_id, "2026-02").expect("compute cumulative");

        assert_eq!(cumulative, 8_000);
    }

    #[test]
    fn cumulative_assigned_cents_is_zero_when_nothing_ever_assigned() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);

        let cumulative = cumulative_assigned_cents(&conn, category_id, "2026-02").expect("compute cumulative");

        assert_eq!(cumulative, 0);
    }

    #[test]
    fn ready_to_assign_cents_starts_as_all_income_when_nothing_is_assigned() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-03-01", 300_000, "Paycheck", None)
            .expect("create transaction");

        let ready = ready_to_assign_cents(&conn, "2026-03").expect("compute ready to assign");

        assert_eq!(ready, 300_000);
    }

    #[test]
    fn ready_to_assign_cents_goes_down_when_you_assign() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-03-01", 300_000, "Paycheck", None)
            .expect("create transaction");
        assign(&conn, category_id, "2026-03", 50_000).expect("assign budget");

        let ready = ready_to_assign_cents(&conn, "2026-03").expect("compute ready to assign");

        assert_eq!(ready, 250_000);
    }

    #[test]
    fn ready_to_assign_cents_is_unaffected_by_categories_with_no_assignments() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        // A category exists but is never assigned to or spent from.
        create_test_category(&conn);

        transactions::create(&conn, account_id, "2026-03-01", 300_000, "Paycheck", None)
            .expect("create transaction");

        let ready = ready_to_assign_cents(&conn, "2026-03").expect("compute ready to assign");

        assert_eq!(ready, 300_000);
    }

    #[test]
    fn ready_to_assign_cents_ignores_negative_amounts_as_income_but_not_as_assignment_offset() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-03-01", 300_000, "Paycheck", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-03-05", -4_000, "Groceries", Some(category_id))
            .expect("create transaction");

        let ready = ready_to_assign_cents(&conn, "2026-03").expect("compute ready to assign");

        // Spending doesn't reduce Ready to Assign directly -- only Assigned does.
        assert_eq!(ready, 300_000);
    }

    #[test]
    fn ready_to_assign_cents_is_cumulative_across_months() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-03-01", 300_000, "March paycheck", None)
            .expect("create transaction");
        assign(&conn, category_id, "2026-03", 100_000).expect("assign budget");

        transactions::create(&conn, account_id, "2026-04-01", 300_000, "April paycheck", None)
            .expect("create transaction");

        let april_ready = ready_to_assign_cents(&conn, "2026-04").expect("compute ready to assign");

        // Cumulative income (600000) minus cumulative assigned (100000), even
        // though nothing new was assigned in April.
        assert_eq!(april_ready, 500_000);
    }

    #[test]
    fn list_budget_for_month_returns_one_row_per_category_with_group_info() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = categories::create_group(&conn, "Food").expect("create group").id;
        let category_id = categories::create(&conn, group_id, "Groceries")
            .expect("create category")
            .id;
        let account_id = create_test_account(&conn);

        assign(&conn, category_id, "2026-03", 10_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-03-05", -4_000, "Groceries", Some(category_id))
            .expect("create transaction");

        let lines = list_budget_for_month(&conn, "2026-03").expect("list budget");

        let line = lines
            .iter()
            .find(|l| l.category_id == category_id)
            .expect("groceries line present");
        assert_eq!(line.group_id, group_id);
        assert_eq!(line.group_name, "Food");
        assert_eq!(line.assigned_cents, 10_000);
        assert_eq!(line.activity_cents, -4_000);
        assert_eq!(line.available_cents, 6_000);
    }
}

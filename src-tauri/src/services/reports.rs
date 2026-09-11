//! Cross-Account reporting aggregates for the Reports screen (issue #54,
//! part of the nav-rail IA restructuring in #49 / ADR-0017).
//!
//! Unlike `transactions::daily_income_expense_totals_for_range` (which
//! buckets by individual calendar day, aimed at the Dashboard's
//! this-month-vs-average chart), this module buckets by calendar month --
//! the granularity the Reports Cash Flow tab trends over ("this month",
//! "last N months"). It reuses the same linked-Transfer and `hidden`
//! exclusions as every other income/expense total in the app (see
//! `transactions::income_expense_totals_for_range`), and always aggregates
//! across every Account by default (`account_id: None`), matching the Reports
//! screen's requirement to show a household-wide picture.

use rusqlite::Connection;

use super::transactions;

/// One month's aggregated income, expense, and net cash flow, across every
/// Account. `month` is `"YYYY-MM"`. `net_cents` is simply `income_cents -
/// expense_cents`, precomputed so callers (e.g. the Cash Flow chart) don't
/// need to re-derive it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct MonthlyCashFlow {
    pub month: String,
    pub income_cents: i64,
    pub expense_cents: i64,
    pub net_cents: i64,
}

/// The first day of `month` ("YYYY-MM") as "YYYY-MM-DD".
fn month_start_date(month: &str) -> Option<String> {
    let (year, mon) = month.split_once('-')?;
    let year: i32 = year.parse().ok()?;
    let mon: u32 = mon.parse().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, mon, 1).map(|d| d.format("%Y-%m-%d").to_string())
}

/// The last day of `month` ("YYYY-MM") as "YYYY-MM-DD".
fn month_end_date(month: &str) -> Option<String> {
    let (year, mon) = month.split_once('-')?;
    let year: i32 = year.parse().ok()?;
    let mon: u32 = mon.parse().ok()?;
    let (next_year, next_mon) = if mon == 12 { (year + 1, 1) } else { (year, mon + 1) };
    let first_of_next = chrono::NaiveDate::from_ymd_opt(next_year, next_mon, 1)?;
    Some((first_of_next - chrono::Duration::days(1)).format("%Y-%m-%d").to_string())
}

/// `month` shifted by `delta` calendar months (may be negative), as
/// "YYYY-MM".
fn add_months(month: &str, delta: i32) -> Option<String> {
    let (year, mon) = month.split_once('-')?;
    let year: i32 = year.parse().ok()?;
    let mon: i32 = mon.parse().ok()?;
    let total = (year * 12 + (mon - 1)) + delta;
    let new_year = total.div_euclid(12);
    let new_mon = total.rem_euclid(12) + 1;
    Some(format!("{new_year:04}-{new_mon:02}"))
}

/// Income, expense, and net cash flow trended month-by-month across every
/// Account, from `start_month` through `end_month` (both inclusive, each
/// "YYYY-MM"). Always aggregates across all Accounts (there is no
/// per-Account variant -- Reports is explicitly a household-wide view, per
/// #49's "Reports (new)" decision).
///
/// Excludes linked Transfers and Hidden Transactions from every month's
/// totals, same as the rest of the app's income/expense reporting.
///
/// A range with no data (or `end_month` before `start_month`) returns a
/// well-defined result rather than an error: each month in range (if any)
/// gets a zero-valued row, and an inverted range returns an empty `Vec`.
pub fn monthly_cash_flow_for_range(
    conn: &Connection,
    start_month: &str,
    end_month: &str,
) -> rusqlite::Result<Vec<MonthlyCashFlow>> {
    let invalid = |field: &str| rusqlite::Error::InvalidParameterName(field.to_string());
    // Parsed only to validate and to walk months one at a time; the actual
    // per-month date bounds come from `month_start_date`/`month_end_date`.
    if month_start_date(start_month).is_none() {
        return Err(invalid("start_month"));
    }
    if month_start_date(end_month).is_none() {
        return Err(invalid("end_month"));
    }

    let mut result = Vec::new();
    let mut current = start_month.to_string();

    // Guard against a malformed/inverted range looping forever; a Reports
    // range is never realistically more than a few hundred months.
    for _ in 0..1200 {
        if current.as_str() > end_month {
            break;
        }

        let month_start = month_start_date(&current).ok_or_else(|| invalid("month"))?;
        let month_end = month_end_date(&current).ok_or_else(|| invalid("month"))?;
        let (income_cents, expense_cents) =
            transactions::income_expense_totals_for_range(conn, None, &month_start, &month_end)?;

        result.push(MonthlyCashFlow {
            month: current.clone(),
            income_cents,
            expense_cents,
            net_cents: income_cents - expense_cents,
        });

        current = add_months(&current, 1).ok_or_else(|| invalid("month"))?;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};
    use crate::services::transactions;
    use crate::services::transfers;

    fn create_test_account(conn: &Connection) -> i64 {
        accounts::create(conn, "Everyday Checking", AccountType::Checking, None)
            .expect("create account")
            .id
    }

    #[test]
    fn monthly_cash_flow_for_range_aggregates_across_every_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let savings_id = create_test_account(&conn);

        transactions::create(&conn, checking_id, "2026-08-05", 5_000, "Paycheck", None)
            .expect("create transaction");
        transactions::create(&conn, savings_id, "2026-08-10", 1_000, "Interest", None)
            .expect("create transaction");
        transactions::create(&conn, checking_id, "2026-08-15", -2_000, "Groceries", None)
            .expect("create transaction");

        let months = monthly_cash_flow_for_range(&conn, "2026-08", "2026-08")
            .expect("compute monthly cash flow");

        assert_eq!(
            months,
            vec![MonthlyCashFlow {
                month: "2026-08".to_string(),
                income_cents: 6_000,
                expense_cents: 2_000,
                net_cents: 4_000,
            }]
        );
    }

    #[test]
    fn monthly_cash_flow_for_range_excludes_a_linked_transfer_pair() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let checking_id = create_test_account(&conn);
        let credit_card_id = create_test_account(&conn);

        let out = transactions::create(&conn, checking_id, "2026-08-10", -50_000, "CC payment", None)
            .expect("create transaction");
        let in_ = transactions::create(&conn, credit_card_id, "2026-08-10", 50_000, "Payment received", None)
            .expect("create transaction");
        transfers::link(&conn, out.id, in_.id).expect("link transfer");

        transactions::create(&conn, checking_id, "2026-08-12", -2_500, "Groceries", None)
            .expect("create transaction");
        transactions::create(&conn, checking_id, "2026-08-13", 3_000, "Refund", None)
            .expect("create transaction");

        let months = monthly_cash_flow_for_range(&conn, "2026-08", "2026-08")
            .expect("compute monthly cash flow");

        assert_eq!(months.len(), 1);
        assert_eq!(months[0].income_cents, 3_000);
        assert_eq!(months[0].expense_cents, 2_500);
        assert_eq!(months[0].net_cents, 500);
    }

    #[test]
    fn monthly_cash_flow_for_range_excludes_a_hidden_transaction() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        let hidden = transactions::create(&conn, account_id, "2026-08-01", -5_000, "Hidden expense", None)
            .expect("create transaction");
        transactions::set_hidden(&conn, hidden.id, true).expect("set hidden");
        transactions::create(&conn, account_id, "2026-08-02", -2_500, "Groceries", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-08-03", 3_000, "Refund", None)
            .expect("create transaction");

        let months = monthly_cash_flow_for_range(&conn, "2026-08", "2026-08")
            .expect("compute monthly cash flow");

        assert_eq!(months.len(), 1);
        assert_eq!(months[0].income_cents, 3_000);
        assert_eq!(months[0].expense_cents, 2_500);
    }

    #[test]
    fn monthly_cash_flow_for_range_spans_multiple_months_in_order() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);

        transactions::create(&conn, account_id, "2026-07-15", 1_000, "July income", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-08-15", 2_000, "August income", None)
            .expect("create transaction");
        transactions::create(&conn, account_id, "2026-09-15", 3_000, "September income", None)
            .expect("create transaction");

        let months = monthly_cash_flow_for_range(&conn, "2026-07", "2026-09")
            .expect("compute monthly cash flow");

        assert_eq!(months.iter().map(|m| m.month.clone()).collect::<Vec<_>>(), vec![
            "2026-07".to_string(),
            "2026-08".to_string(),
            "2026-09".to_string(),
        ]);
        assert_eq!(months[0].income_cents, 1_000);
        assert_eq!(months[1].income_cents, 2_000);
        assert_eq!(months[2].income_cents, 3_000);
    }

    #[test]
    fn monthly_cash_flow_for_range_returns_a_zero_valued_row_for_a_month_with_no_data() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let months = monthly_cash_flow_for_range(&conn, "2026-08", "2026-08")
            .expect("compute monthly cash flow");

        assert_eq!(
            months,
            vec![MonthlyCashFlow {
                month: "2026-08".to_string(),
                income_cents: 0,
                expense_cents: 0,
                net_cents: 0,
            }]
        );
    }

    #[test]
    fn monthly_cash_flow_for_range_returns_an_empty_vec_for_an_inverted_range() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let months = monthly_cash_flow_for_range(&conn, "2026-09", "2026-08")
            .expect("compute monthly cash flow");

        assert_eq!(months, Vec::new());
    }
}

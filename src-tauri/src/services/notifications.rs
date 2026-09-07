use rusqlite::Connection;
use serde::Serialize;

use crate::services::budgets;
use crate::services::recurring_items;

/// A notification-worthy condition that is currently true and has not yet
/// been surfaced to the user. Returned by `pending` for the Tauri layer to
/// turn into a native OS notification (see `commands::run_notification_check`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NotificationCandidate {
    UpcomingBill {
        recurring_item_id: i64,
        description: String,
        amount_cents: i64,
        next_expected_date: String,
    },
    CategoryOverspend {
        category_id: i64,
        category_name: String,
        month: String,
        /// Positive number of cents spent this month beyond what was Assigned
        /// (i.e. `-(assigned_cents + activity_cents)`).
        overspent_cents: i64,
    },
}

impl NotificationCandidate {
    /// The `(condition_type, condition_key)` pair used to dedupe this exact
    /// condition instance in `notification_log`.
    fn log_key(&self) -> (&'static str, String) {
        match self {
            NotificationCandidate::UpcomingBill {
                recurring_item_id,
                next_expected_date,
                ..
            } => ("upcoming_bill", format!("{recurring_item_id}:{next_expected_date}")),
            NotificationCandidate::CategoryOverspend { category_id, month, .. } => {
                ("category_overspend", format!("{category_id}:{month}"))
            }
        }
    }

    /// Title/body text for the native OS notification.
    pub fn title_and_body(&self) -> (String, String) {
        match self {
            NotificationCandidate::UpcomingBill {
                description,
                amount_cents,
                next_expected_date,
                ..
            } => (
                format!("Upcoming bill: {description}"),
                format!("{} due {next_expected_date}", format_cents(*amount_cents)),
            ),
            NotificationCandidate::CategoryOverspend {
                category_name,
                overspent_cents,
                ..
            } => (
                format!("Over budget: {category_name}"),
                format!("{} over Assigned this month", format_cents(*overspent_cents)),
            ),
        }
    }
}

fn format_cents(cents: i64) -> String {
    format!("${:.2}", (cents.abs() as f64) / 100.0)
}

fn has_notified(conn: &Connection, condition_type: &str, condition_key: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM notification_log WHERE condition_type = ?1 AND condition_key = ?2)",
        rusqlite::params![condition_type, condition_key],
        |row| row.get(0),
    )
}

fn record_notified(conn: &Connection, condition_type: &str, condition_key: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO notification_log (condition_type, condition_key) VALUES (?1, ?2) \
         ON CONFLICT (condition_type, condition_key) DO NOTHING",
        rusqlite::params![condition_type, condition_key],
    )?;
    Ok(())
}

/// Drops any logged "already notified" rows of `condition_type` whose key is
/// not in `current_keys` -- i.e. conditions that were notified before but are
/// no longer true. This is what lets a resolved-then-recurring condition (a
/// bill paid and predicted again, an overspend fixed and then reintroduced)
/// notify a second time instead of being permanently suppressed.
fn clear_resolved(conn: &Connection, condition_type: &str, current_keys: &[String]) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("SELECT condition_key FROM notification_log WHERE condition_type = ?1")?;
    let logged_keys: Vec<String> = stmt
        .query_map([condition_type], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    for key in logged_keys {
        if !current_keys.contains(&key) {
            conn.execute(
                "DELETE FROM notification_log WHERE condition_type = ?1 AND condition_key = ?2",
                rusqlite::params![condition_type, key],
            )?;
        }
    }
    Ok(())
}

/// Every currently-true upcoming-bill / category-overspend condition,
/// regardless of whether it has already been notified. Exposed separately
/// from `pending` so callers/tests can inspect "what's true right now"
/// without the notified-log side effects.
pub fn evaluate(
    conn: &Connection,
    as_of: &str,
    bill_window_days: i64,
    month: &str,
    bills_enabled: bool,
    overspend_enabled: bool,
) -> rusqlite::Result<Vec<NotificationCandidate>> {
    let mut candidates = Vec::new();

    if bills_enabled {
        for item in recurring_items::upcoming_all(conn, as_of, bill_window_days)? {
            candidates.push(NotificationCandidate::UpcomingBill {
                recurring_item_id: item.id,
                description: item.description,
                amount_cents: item.amount_cents,
                next_expected_date: item.next_expected_date,
            });
        }
    }

    if overspend_enabled {
        for line in budgets::list_budget_for_month(conn, month)? {
            let month_net_cents = line.assigned_cents + line.activity_cents;
            if month_net_cents < 0 {
                candidates.push(NotificationCandidate::CategoryOverspend {
                    category_id: line.category_id,
                    category_name: line.category_name,
                    month: month.to_string(),
                    overspent_cents: -month_net_cents,
                });
            }
        }
    }

    Ok(candidates)
}

/// The subset of `evaluate`'s currently-true conditions that have not already
/// been notified. As a side effect, newly-returned conditions are recorded in
/// `notification_log` (so a second call with the same state returns nothing
/// for them), and log entries for conditions that are no longer true are
/// cleared (so they can notify again if they recur).
///
/// This is the single entry point the Tauri layer polls (see
/// `commands::run_notification_check`): each condition it returns should
/// become exactly one native OS notification.
pub fn pending(
    conn: &Connection,
    as_of: &str,
    bill_window_days: i64,
    month: &str,
    bills_enabled: bool,
    overspend_enabled: bool,
) -> rusqlite::Result<Vec<NotificationCandidate>> {
    let current = evaluate(conn, as_of, bill_window_days, month, bills_enabled, overspend_enabled)?;

    if bills_enabled {
        let bill_keys: Vec<String> = current
            .iter()
            .filter_map(|c| match c.log_key() {
                ("upcoming_bill", key) => Some(key),
                _ => None,
            })
            .collect();
        clear_resolved(conn, "upcoming_bill", &bill_keys)?;
    }

    if overspend_enabled {
        let overspend_keys: Vec<String> = current
            .iter()
            .filter_map(|c| match c.log_key() {
                ("category_overspend", key) => Some(key),
                _ => None,
            })
            .collect();
        clear_resolved(conn, "category_overspend", &overspend_keys)?;
    }

    let mut fresh = Vec::new();
    for candidate in current {
        let (condition_type, condition_key) = candidate.log_key();
        if !has_notified(conn, condition_type, &condition_key)? {
            record_notified(conn, condition_type, &condition_key)?;
            fresh.push(candidate);
        }
    }

    Ok(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};
    use crate::services::categories;
    use crate::services::recurring_items::Frequency;
    use crate::services::transactions;

    fn create_test_account(conn: &Connection) -> i64 {
        accounts::create(conn, "Checking", AccountType::Checking, None)
            .expect("create account")
            .id
    }

    fn create_test_category(conn: &Connection) -> i64 {
        let group_id = categories::create_group(conn, "Bills").expect("create group").id;
        categories::create(conn, group_id, "Subscriptions")
            .expect("create category")
            .id
    }

    #[test]
    fn evaluate_finds_an_upcoming_bill_within_the_window() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        recurring_items::create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");

        let candidates =
            evaluate(&conn, "2026-09-10", 7, "2026-09", true, true).expect("evaluate notifications");

        assert_eq!(candidates.len(), 1);
        assert!(matches!(
            &candidates[0],
            NotificationCandidate::UpcomingBill { description, .. } if description == "Netflix"
        ));
    }

    #[test]
    fn evaluate_ignores_bills_outside_the_window() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        recurring_items::create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-10-15", None)
            .expect("create recurring item");

        let candidates =
            evaluate(&conn, "2026-09-10", 7, "2026-09", true, true).expect("evaluate notifications");

        assert!(candidates.is_empty());
    }

    #[test]
    fn evaluate_skips_bills_when_bills_disabled() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        recurring_items::create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");

        let candidates =
            evaluate(&conn, "2026-09-10", 7, "2026-09", false, true).expect("evaluate notifications");

        assert!(candidates.is_empty());
    }

    #[test]
    fn evaluate_finds_a_category_overspent_this_month() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);
        budgets::assign(&conn, category_id, "2026-09", 5_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-09-05", -8_000, "Overspent", Some(category_id))
            .expect("create transaction");

        let candidates =
            evaluate(&conn, "2026-09-10", 7, "2026-09", true, true).expect("evaluate notifications");

        assert_eq!(candidates.len(), 1);
        assert!(matches!(
            &candidates[0],
            NotificationCandidate::CategoryOverspend { overspent_cents, .. } if *overspent_cents == 3_000
        ));
    }

    #[test]
    fn evaluate_ignores_a_category_within_its_assigned_amount() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);
        budgets::assign(&conn, category_id, "2026-09", 5_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-09-05", -3_000, "Fine", Some(category_id))
            .expect("create transaction");

        let candidates =
            evaluate(&conn, "2026-09-10", 7, "2026-09", true, true).expect("evaluate notifications");

        assert!(candidates.is_empty());
    }

    #[test]
    fn evaluate_skips_overspend_when_disabled() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);
        budgets::assign(&conn, category_id, "2026-09", 5_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-09-05", -8_000, "Overspent", Some(category_id))
            .expect("create transaction");

        let candidates =
            evaluate(&conn, "2026-09-10", 7, "2026-09", true, false).expect("evaluate notifications");

        assert!(candidates.is_empty());
    }

    #[test]
    fn pending_does_not_renotify_an_unresolved_condition() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);
        budgets::assign(&conn, category_id, "2026-09", 5_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-09-05", -8_000, "Overspent", Some(category_id))
            .expect("create transaction");

        let first = pending(&conn, "2026-09-10", 7, "2026-09", true, true).expect("first pending check");
        let second = pending(&conn, "2026-09-10", 7, "2026-09", true, true).expect("second pending check");

        assert_eq!(first.len(), 1);
        assert!(second.is_empty(), "an unresolved condition should not fire twice");
    }

    #[test]
    fn pending_notifies_again_after_a_resolved_overspend_recurs() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn);
        let account_id = create_test_account(&conn);
        budgets::assign(&conn, category_id, "2026-09", 5_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-09-05", -8_000, "Overspent", Some(category_id))
            .expect("create transaction");

        let first = pending(&conn, "2026-09-10", 7, "2026-09", true, true).expect("first pending check");
        assert_eq!(first.len(), 1);

        // Resolve it: assign enough to cover the spend.
        budgets::assign(&conn, category_id, "2026-09", 9_000).expect("top up assignment");
        let resolved = pending(&conn, "2026-09-11", 7, "2026-09", true, true).expect("resolved pending check");
        assert!(resolved.is_empty());

        // Re-overspend the same category/month.
        transactions::create(&conn, account_id, "2026-09-12", -5_000, "Overspent again", Some(category_id))
            .expect("create transaction");
        let second = pending(&conn, "2026-09-13", 7, "2026-09", true, true).expect("second pending check");

        assert_eq!(second.len(), 1, "a resolved-then-recurring overspend should notify again");
    }

    #[test]
    fn pending_notifies_again_once_a_bills_next_expected_date_rolls_forward() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let item =
            recurring_items::create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
                .expect("create recurring item");

        let first = pending(&conn, "2026-09-10", 7, "2026-09", true, true).expect("first pending check");
        assert_eq!(first.len(), 1);
        let second = pending(&conn, "2026-09-11", 7, "2026-09", true, true).expect("second pending check");
        assert!(second.is_empty());

        // The bill was paid and the next occurrence predicted a month later.
        recurring_items::update(
            &conn,
            item.id,
            "Netflix",
            -1599,
            Frequency::Monthly,
            "2026-10-15",
            None,
        )
        .expect("roll recurring item forward");

        let third = pending(&conn, "2026-10-10", 7, "2026-10", true, true).expect("third pending check");
        assert_eq!(third.len(), 1, "a new due date is a new condition and should notify");
    }

    #[test]
    fn pending_respects_independent_toggles() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = create_test_account(&conn);
        let category_id = create_test_category(&conn);
        recurring_items::create(&conn, account_id, "Netflix", -1599, Frequency::Monthly, "2026-09-15", None)
            .expect("create recurring item");
        budgets::assign(&conn, category_id, "2026-09", 5_000).expect("assign budget");
        transactions::create(&conn, account_id, "2026-09-05", -8_000, "Overspent", Some(category_id))
            .expect("create transaction");

        let bills_only = pending(&conn, "2026-09-10", 7, "2026-09", true, false).expect("bills-only check");
        assert_eq!(bills_only.len(), 1);
        assert!(matches!(bills_only[0], NotificationCandidate::UpcomingBill { .. }));
    }
}

use rusqlite::{OptionalExtension, Connection};
use serde::{Deserialize, Serialize};

use crate::services::accounts::{self, AccountType};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Holding {
    pub id: i64,
    pub account_id: i64,
    pub ticker: String,
    pub quantity: f64,
    pub cost_basis_cents: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SecurityPrice {
    pub id: i64,
    pub ticker: String,
    pub price_cents: i64,
    pub as_of_date: String,
}

/// A holding joined with its latest known price, for rendering without
/// N+1 requests. `price_cents`/`as_of_date` are None when the ticker has
/// never had a price entered -- the UI must treat that as "unpriced", not
/// as a $0 valuation (see ADR-0003).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HoldingWithValue {
    pub id: i64,
    pub account_id: i64,
    pub ticker: String,
    pub quantity: f64,
    pub cost_basis_cents: Option<i64>,
    pub price_cents: Option<i64>,
    pub as_of_date: Option<String>,
    pub value_cents: Option<i64>,
}

/// A `HoldingWithValue` plus the identifying metadata of the investment
/// Account it belongs to -- for the all-Accounts Investments screen (#53),
/// where rows from multiple Accounts are shown together and the Account
/// needs to be legible per-row (mirrors the `account_name` join pattern used
/// by `csv_export`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HoldingWithAccount {
    pub id: i64,
    pub account_id: i64,
    pub account_name: String,
    pub ticker: String,
    pub quantity: f64,
    pub cost_basis_cents: Option<i64>,
    pub price_cents: Option<i64>,
    pub as_of_date: Option<String>,
    pub value_cents: Option<i64>,
}

fn holding_from_row(row: &rusqlite::Row) -> rusqlite::Result<Holding> {
    Ok(Holding {
        id: row.get(0)?,
        account_id: row.get(1)?,
        ticker: row.get(2)?,
        quantity: row.get(3)?,
        cost_basis_cents: row.get(4)?,
    })
}

fn price_from_row(row: &rusqlite::Row) -> rusqlite::Result<SecurityPrice> {
    Ok(SecurityPrice {
        id: row.get(0)?,
        ticker: row.get(1)?,
        price_cents: row.get(2)?,
        as_of_date: row.get(3)?,
    })
}

pub fn create_holding(
    conn: &Connection,
    account_id: i64,
    ticker: &str,
    quantity: f64,
    cost_basis_cents: Option<i64>,
) -> rusqlite::Result<Holding> {
    conn.execute(
        "INSERT INTO holdings (account_id, ticker, quantity, cost_basis_cents) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![account_id, ticker, quantity, cost_basis_cents],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Holding {
        id,
        account_id,
        ticker: ticker.to_string(),
        quantity,
        cost_basis_cents,
    })
}

pub fn list_holdings_for_account(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<Holding>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, ticker, quantity, cost_basis_cents FROM holdings WHERE account_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([account_id], holding_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get_holding(conn: &Connection, id: i64) -> rusqlite::Result<Option<Holding>> {
    conn.query_row(
        "SELECT id, account_id, ticker, quantity, cost_basis_cents FROM holdings WHERE id = ?1",
        [id],
        holding_from_row,
    )
    .optional()
}

pub fn update_holding(
    conn: &Connection,
    id: i64,
    ticker: &str,
    quantity: f64,
    cost_basis_cents: Option<i64>,
) -> rusqlite::Result<Holding> {
    let account_id: i64 = conn
        .query_row("SELECT account_id FROM holdings WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|_| rusqlite::Error::QueryReturnedNoRows)?;

    let rows_affected = conn.execute(
        "UPDATE holdings SET ticker = ?1, quantity = ?2, cost_basis_cents = ?3, updated_at = datetime('now') WHERE id = ?4",
        rusqlite::params![ticker, quantity, cost_basis_cents, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(Holding {
        id,
        account_id,
        ticker: ticker.to_string(),
        quantity,
        cost_basis_cents,
    })
}

pub fn delete_holding(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM holdings WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Inserts a new price point for `ticker` at `as_of_date`. If a row for
/// that exact ticker+as_of_date already exists, it is updated in place
/// rather than duplicated (same-day re-entry is a correction, not a new
/// data point).
pub fn set_price(
    conn: &Connection,
    ticker: &str,
    price_cents: i64,
    as_of_date: &str,
) -> rusqlite::Result<SecurityPrice> {
    conn.execute(
        "INSERT INTO security_prices (ticker, price_cents, as_of_date) VALUES (?1, ?2, ?3)
         ON CONFLICT (ticker, as_of_date) DO UPDATE SET price_cents = excluded.price_cents",
        rusqlite::params![ticker, price_cents, as_of_date],
    )?;

    conn.query_row(
        "SELECT id, ticker, price_cents, as_of_date FROM security_prices WHERE ticker = ?1 AND as_of_date = ?2",
        rusqlite::params![ticker, as_of_date],
        price_from_row,
    )
}

/// The most recent price for `ticker` by as_of_date (not by insertion
/// order -- a price for an earlier date entered later must not shadow a
/// price for a later date entered earlier).
pub fn latest_price(conn: &Connection, ticker: &str) -> rusqlite::Result<Option<SecurityPrice>> {
    conn.query_row(
        "SELECT id, ticker, price_cents, as_of_date FROM security_prices
         WHERE ticker = ?1 ORDER BY as_of_date DESC, id DESC LIMIT 1",
        [ticker],
        price_from_row,
    )
    .optional()
}

/// quantity * latest price's price_cents for `holding`. None if no price
/// has ever been entered for the holding's ticker -- callers must treat
/// this as "unpriced", never silently render it as $0 (see ADR-0003).
pub fn holding_value_cents(conn: &Connection, holding: &Holding) -> rusqlite::Result<Option<i64>> {
    let price = latest_price(conn, &holding.ticker)?;
    Ok(price.map(|p| (holding.quantity * p.price_cents as f64).round() as i64))
}

/// Sum of all priced holdings' values for `account_id`. Unpriced holdings
/// contribute 0 to this sum (they must be flagged separately in the UI,
/// not hidden or treated as zero-value positions).
///
/// Not yet exposed as a Tauri command -- the Holdings screen renders a
/// per-holding table via `list_holdings_with_values` and sums the visible
/// rows itself. Kept here (and tested) as the service-layer primitive for
/// when a dashboard/summary view needs an account-level total directly.
#[cfg_attr(not(test), allow(dead_code))]
pub fn account_holdings_value_cents(conn: &Connection, account_id: i64) -> rusqlite::Result<i64> {
    let holdings = list_holdings_for_account(conn, account_id)?;
    let mut total = 0i64;
    for holding in &holdings {
        if let Some(value) = holding_value_cents(conn, holding)? {
            total += value;
        }
    }
    Ok(total)
}

/// Holdings for `account_id` joined with their latest price + computed
/// value, in one call -- the frontend should use this instead of N+1
/// per-ticker price lookups.
pub fn list_holdings_with_values(conn: &Connection, account_id: i64) -> rusqlite::Result<Vec<HoldingWithValue>> {
    let holdings = list_holdings_for_account(conn, account_id)?;
    let mut result = Vec::with_capacity(holdings.len());
    for holding in holdings {
        let price = latest_price(conn, &holding.ticker)?;
        let value_cents = holding_value_cents(conn, &holding)?;
        let (price_cents, as_of_date) = match price {
            Some(p) => (Some(p.price_cents), Some(p.as_of_date)),
            None => (None, None),
        };
        result.push(HoldingWithValue {
            id: holding.id,
            account_id: holding.account_id,
            ticker: holding.ticker,
            quantity: holding.quantity,
            cost_basis_cents: holding.cost_basis_cents,
            price_cents,
            as_of_date,
            value_cents,
        });
    }
    Ok(result)
}

/// All Holdings across every investment Account (not just one), joined with
/// value the same way `list_holdings_with_values` is, plus each row's
/// Account id/name -- for the all-Accounts Investments screen (#53). The
/// existing per-Account `list_holdings_for_account`/`list_holdings_with_values`
/// are untouched and remain the per-Account query, e.g. for the Import flow.
/// Non-investment Accounts (checking, savings, etc.) never hold Holdings in
/// practice, but this filters to `AccountType::Investment` explicitly rather
/// than relying on that invariant.
pub fn list_all_holdings_with_values(conn: &Connection) -> rusqlite::Result<Vec<HoldingWithAccount>> {
    let investment_accounts: Vec<(i64, String)> = accounts::list(conn)?
        .into_iter()
        .filter(|account| account.account_type == AccountType::Investment)
        .map(|account| (account.id, account.name))
        .collect();

    let mut result = Vec::new();
    for (account_id, account_name) in investment_accounts {
        let holdings = list_holdings_with_values(conn, account_id)?;
        result.extend(holdings.into_iter().map(|h| HoldingWithAccount {
            id: h.id,
            account_id: h.account_id,
            account_name: account_name.clone(),
            ticker: h.ticker,
            quantity: h.quantity,
            cost_basis_cents: h.cost_basis_cents,
            price_cents: h.price_cents,
            as_of_date: h.as_of_date,
            value_cents: h.value_cents,
        }));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};

    fn setup_account(conn: &Connection) -> i64 {
        accounts::create(conn, "Brokerage", AccountType::Investment, None)
            .expect("create account")
            .id
    }

    #[test]
    fn create_returns_the_new_holding_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);

        let holding = create_holding(&conn, account_id, "VTI", 12.5, Some(150000)).expect("create holding");

        assert_eq!(holding.ticker, "VTI");
        assert_eq!(holding.quantity, 12.5);
        assert_eq!(holding.cost_basis_cents, Some(150000));
        assert!(holding.id > 0);
    }

    #[test]
    fn list_holdings_for_account_returns_only_that_account_s_holdings() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        let other_account_id = setup_account(&conn);
        create_holding(&conn, account_id, "VTI", 12.5, None).expect("create holding");
        create_holding(&conn, other_account_id, "VOO", 3.0, None).expect("create holding");

        let holdings = list_holdings_for_account(&conn, account_id).expect("list holdings");

        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].ticker, "VTI");
    }

    #[test]
    fn update_holding_changes_the_stored_fields() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        let created = create_holding(&conn, account_id, "VTI", 12.5, None).expect("create holding");

        let updated = update_holding(&conn, created.id, "VOO", 20.0, Some(200000)).expect("update holding");

        assert_eq!(updated.ticker, "VOO");
        assert_eq!(updated.quantity, 20.0);
        assert_eq!(updated.cost_basis_cents, Some(200000));
        assert_eq!(get_holding(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_holding_fails_when_it_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update_holding(&conn, 999, "VOO", 20.0, None);

        assert!(result.is_err());
    }

    #[test]
    fn delete_holding_removes_it() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        let created = create_holding(&conn, account_id, "VTI", 12.5, None).expect("create holding");

        delete_holding(&conn, created.id).expect("delete holding");

        assert_eq!(get_holding(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_holding_fails_when_it_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete_holding(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn deleting_an_account_cascades_to_its_holdings() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        let created = create_holding(&conn, account_id, "VTI", 12.5, None).expect("create holding");

        accounts::delete(&conn, account_id).expect("delete account");

        assert_eq!(get_holding(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn set_price_upserts_same_day_rows_rather_than_duplicating() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        set_price(&conn, "VTI", 25000, "2026-09-01").expect("set price");
        set_price(&conn, "VTI", 25500, "2026-09-01").expect("set price again same day");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM security_prices WHERE ticker = 'VTI' AND as_of_date = '2026-09-01'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        let latest = latest_price(&conn, "VTI").expect("latest price").expect("some price");
        assert_eq!(latest.price_cents, 25500);
    }

    #[test]
    fn latest_price_picks_the_most_recent_as_of_date_not_insertion_order() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        set_price(&conn, "VTI", 25000, "2026-09-05").expect("set price");
        set_price(&conn, "VTI", 24000, "2026-09-01").expect("set an earlier-dated price after");

        let latest = latest_price(&conn, "VTI").expect("latest price").expect("some price");

        assert_eq!(latest.as_of_date, "2026-09-05");
        assert_eq!(latest.price_cents, 25000);
    }

    #[test]
    fn latest_price_is_none_for_an_unpriced_ticker() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let latest = latest_price(&conn, "UNKNOWN").expect("latest price query");

        assert_eq!(latest, None);
    }

    #[test]
    fn holding_value_cents_returns_none_with_no_price() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        let holding = create_holding(&conn, account_id, "VTI", 10.0, None).expect("create holding");

        let value = holding_value_cents(&conn, &holding).expect("compute value");

        assert_eq!(value, None);
    }

    #[test]
    fn holding_value_cents_returns_the_correct_product_with_a_price() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        let holding = create_holding(&conn, account_id, "VTI", 10.0, None).expect("create holding");
        set_price(&conn, "VTI", 25000, "2026-09-01").expect("set price");

        let value = holding_value_cents(&conn, &holding).expect("compute value");

        assert_eq!(value, Some(250000));
    }

    #[test]
    fn account_holdings_value_cents_sums_correctly_and_treats_unpriced_as_zero() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        create_holding(&conn, account_id, "VTI", 10.0, None).expect("create holding");
        create_holding(&conn, account_id, "UNPRICED", 5.0, None).expect("create holding");
        set_price(&conn, "VTI", 25000, "2026-09-01").expect("set price");

        let total = account_holdings_value_cents(&conn, account_id).expect("compute total");

        assert_eq!(total, 250000);
    }

    #[test]
    fn account_holdings_value_cents_is_zero_for_an_account_with_no_holdings() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);

        let total = account_holdings_value_cents(&conn, account_id).expect("compute total");

        assert_eq!(total, 0);
    }

    #[test]
    fn list_holdings_with_values_includes_price_and_as_of_date_per_holding() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = setup_account(&conn);
        create_holding(&conn, account_id, "VTI", 10.0, None).expect("create holding");
        create_holding(&conn, account_id, "UNPRICED", 5.0, None).expect("create holding");
        set_price(&conn, "VTI", 25000, "2026-09-01").expect("set price");

        let holdings = list_holdings_with_values(&conn, account_id).expect("list with values");

        let vti = holdings.iter().find(|h| h.ticker == "VTI").unwrap();
        assert_eq!(vti.price_cents, Some(25000));
        assert_eq!(vti.as_of_date.as_deref(), Some("2026-09-01"));
        assert_eq!(vti.value_cents, Some(250000));

        let unpriced = holdings.iter().find(|h| h.ticker == "UNPRICED").unwrap();
        assert_eq!(unpriced.price_cents, None);
        assert_eq!(unpriced.as_of_date, None);
        assert_eq!(unpriced.value_cents, None);
    }

    #[test]
    fn list_all_holdings_with_values_aggregates_across_multiple_investment_accounts() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let brokerage_id = accounts::create(&conn, "Brokerage", AccountType::Investment, None)
            .expect("create account")
            .id;
        let retirement_id = accounts::create(&conn, "401k", AccountType::Investment, None)
            .expect("create account")
            .id;
        create_holding(&conn, brokerage_id, "VTI", 10.0, None).expect("create holding");
        create_holding(&conn, retirement_id, "VOO", 3.0, None).expect("create holding");
        set_price(&conn, "VTI", 25000, "2026-09-01").expect("set price");

        let holdings = list_all_holdings_with_values(&conn).expect("list all holdings");

        assert_eq!(holdings.len(), 2);
        let vti = holdings.iter().find(|h| h.ticker == "VTI").unwrap();
        assert_eq!(vti.account_id, brokerage_id);
        assert_eq!(vti.account_name, "Brokerage");
        assert_eq!(vti.value_cents, Some(250000));

        let voo = holdings.iter().find(|h| h.ticker == "VOO").unwrap();
        assert_eq!(voo.account_id, retirement_id);
        assert_eq!(voo.account_name, "401k");
        assert_eq!(voo.value_cents, None);
    }

    #[test]
    fn list_all_holdings_with_values_excludes_non_investment_accounts() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let investment_id = accounts::create(&conn, "Brokerage", AccountType::Investment, None)
            .expect("create account")
            .id;
        let checking_id = accounts::create(&conn, "Checking", AccountType::Checking, None)
            .expect("create account")
            .id;
        create_holding(&conn, investment_id, "VTI", 10.0, None).expect("create holding");
        // A Holding row under a non-investment Account shouldn't occur in
        // practice, but the query must still filter it out defensively.
        create_holding(&conn, checking_id, "BOGUS", 1.0, None).expect("create holding");

        let holdings = list_all_holdings_with_values(&conn).expect("list all holdings");

        assert_eq!(holdings.len(), 1);
        assert_eq!(holdings[0].ticker, "VTI");
    }

    #[test]
    fn list_all_holdings_with_values_is_empty_with_no_data() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let holdings = list_all_holdings_with_values(&conn).expect("list all holdings");

        assert_eq!(holdings, Vec::new());
    }
}

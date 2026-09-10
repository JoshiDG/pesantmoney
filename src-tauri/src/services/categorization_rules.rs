//! Categorization Rules: a user-defined condition (matching on Transaction
//! description, amount, or Account) that assigns a Category to matching
//! Transactions automatically on Import (see CONTEXT.md). Entirely local —
//! no cloud merchant lookup.

use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleField {
    Description,
    Amount,
    Account,
}

impl RuleField {
    fn as_str(&self) -> &'static str {
        match self {
            RuleField::Description => "description",
            RuleField::Amount => "amount",
            RuleField::Account => "account",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "description" => Some(RuleField::Description),
            "amount" => Some(RuleField::Amount),
            "account" => Some(RuleField::Account),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    Contains,
    Equals,
}

impl MatchType {
    fn as_str(&self) -> &'static str {
        match self {
            MatchType::Contains => "contains",
            MatchType::Equals => "equals",
        }
    }

    fn from_str(s: &str) -> Option<Self> {
        match s {
            "contains" => Some(MatchType::Contains),
            "equals" => Some(MatchType::Equals),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CategorizationRule {
    pub id: i64,
    pub field: RuleField,
    pub match_type: MatchType,
    pub match_value: String,
    pub category_id: i64,
    pub priority: i64,
}

fn rule_from_row(row: &rusqlite::Row) -> rusqlite::Result<CategorizationRule> {
    let field_str: String = row.get(1)?;
    let field = RuleField::from_str(&field_str)
        .ok_or_else(|| rusqlite::Error::InvalidColumnType(1, "field".into(), rusqlite::types::Type::Text))?;
    let match_type_str: String = row.get(2)?;
    let match_type = MatchType::from_str(&match_type_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(2, "match_type".into(), rusqlite::types::Type::Text)
    })?;

    Ok(CategorizationRule {
        id: row.get(0)?,
        field,
        match_type,
        match_value: row.get(3)?,
        category_id: row.get(4)?,
        priority: row.get(5)?,
    })
}

pub fn create(
    conn: &Connection,
    field: RuleField,
    match_type: MatchType,
    match_value: &str,
    category_id: i64,
    priority: i64,
) -> rusqlite::Result<CategorizationRule> {
    conn.execute(
        "INSERT INTO categorization_rules (field, match_type, match_value, category_id, priority) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![field.as_str(), match_type.as_str(), match_value, category_id, priority],
    )?;
    let id = conn.last_insert_rowid();

    Ok(CategorizationRule {
        id,
        field,
        match_type,
        match_value: match_value.to_string(),
        category_id,
        priority,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<CategorizationRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, field, match_type, match_value, category_id, priority \
         FROM categorization_rules ORDER BY priority, id",
    )?;
    let rows = stmt.query_map([], rule_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<CategorizationRule>> {
    conn.query_row(
        "SELECT id, field, match_type, match_value, category_id, priority \
         FROM categorization_rules WHERE id = ?1",
        [id],
        rule_from_row,
    )
    .optional()
}

#[allow(clippy::too_many_arguments)]
pub fn update(
    conn: &Connection,
    id: i64,
    field: RuleField,
    match_type: MatchType,
    match_value: &str,
    category_id: i64,
    priority: i64,
) -> rusqlite::Result<CategorizationRule> {
    let rows_affected = conn.execute(
        "UPDATE categorization_rules SET field = ?1, match_type = ?2, match_value = ?3, \
         category_id = ?4, priority = ?5, updated_at = datetime('now') WHERE id = ?6",
        rusqlite::params![field.as_str(), match_type.as_str(), match_value, category_id, priority, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(CategorizationRule {
        id,
        field,
        match_type,
        match_value: match_value.to_string(),
        category_id,
        priority,
    })
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM categorization_rules WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Whether a single rule matches the given Transaction fields.
fn rule_matches(rule: &CategorizationRule, account_id: i64, amount_cents: i64, description: &str) -> bool {
    match rule.field {
        RuleField::Description => match rule.match_type {
            MatchType::Contains => description
                .to_lowercase()
                .contains(&rule.match_value.to_lowercase()),
            MatchType::Equals => description.to_lowercase() == rule.match_value.to_lowercase(),
        },
        RuleField::Amount => {
            // match_value stores a stringified cents value compared for equality,
            // regardless of the rule's match_type.
            rule.match_value.parse::<i64>() == Ok(amount_cents)
        }
        RuleField::Account => {
            // match_value stores an account_id as text, compared for equality,
            // regardless of the rule's match_type.
            rule.match_value.parse::<i64>() == Ok(account_id)
        }
    }
}

/// Returns the category_id of the first matching rule (by priority, lower
/// runs first), or `None` if no rule matches this Transaction.
///
/// A `Description`-field rule matches against the Transaction's identified
/// Merchant name when one is present (see `services::merchants`, passed via
/// `merchant_name`), falling back to the raw `description` when it isn't (or
/// when the caller passes `None`, e.g. for a Transaction that predates
/// Merchant identification or was entered manually) — so existing rules keep
/// working unchanged for unidentified Transactions, and new rules can be
/// written against clean merchant names (see issue #36).
pub fn apply_to_transaction_with_merchant(
    conn: &Connection,
    account_id: i64,
    _date: &str,
    amount_cents: i64,
    description: &str,
    merchant_name: Option<&str>,
) -> rusqlite::Result<Option<i64>> {
    let description_for_matching = merchant_name.unwrap_or(description);
    let rules = list(conn)?;
    Ok(rules
        .iter()
        .find(|rule| rule_matches(rule, account_id, amount_cents, description_for_matching))
        .map(|rule| rule.category_id))
}

/// Backfill: scans existing Transactions with `category_id IS NULL`,
/// optionally scoped to one Account, applies matching rules, and returns the
/// count of Transactions updated.
pub fn apply_to_uncategorized(conn: &Connection, account_id: Option<i64>) -> rusqlite::Result<usize> {
    struct UncategorizedTransaction {
        id: i64,
        account_id: i64,
        date: String,
        amount_cents: i64,
        description: String,
        merchant_name: Option<String>,
    }

    let mut stmt = match account_id {
        Some(_) => conn.prepare(
            "SELECT id, account_id, date, amount_cents, description, merchant_name FROM transactions \
             WHERE category_id IS NULL AND account_id = ?1",
        )?,
        None => conn.prepare(
            "SELECT id, account_id, date, amount_cents, description, merchant_name FROM transactions \
             WHERE category_id IS NULL",
        )?,
    };

    let row_mapper = |row: &rusqlite::Row| {
        Ok(UncategorizedTransaction {
            id: row.get(0)?,
            account_id: row.get(1)?,
            date: row.get(2)?,
            amount_cents: row.get(3)?,
            description: row.get(4)?,
            merchant_name: row.get(5)?,
        })
    };

    let transactions: Vec<UncategorizedTransaction> = match account_id {
        Some(id) => stmt.query_map([id], row_mapper)?.collect::<rusqlite::Result<_>>()?,
        None => stmt.query_map([], row_mapper)?.collect::<rusqlite::Result<_>>()?,
    };

    let mut updated_count = 0;
    for txn in transactions {
        if let Some(category_id) = apply_to_transaction_with_merchant(
            conn,
            txn.account_id,
            &txn.date,
            txn.amount_cents,
            &txn.description,
            txn.merchant_name.as_deref(),
        )? {
            conn.execute(
                "UPDATE transactions SET category_id = ?1, updated_at = datetime('now') WHERE id = ?2",
                rusqlite::params![category_id, txn.id],
            )?;
            updated_count += 1;
        }
    }

    Ok(updated_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::categories;
    use crate::services::transactions;

    fn create_test_category(conn: &Connection, name: &str) -> i64 {
        let group_id = categories::create_group(conn, "Test Group").expect("create group").id;
        categories::create(conn, group_id, name).expect("create category").id
    }

    #[test]
    fn create_returns_the_new_rule_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");

        let rule = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "grocery",
            category_id,
            0,
        )
        .expect("create rule");

        assert_eq!(rule.match_value, "grocery");
        assert_eq!(rule.category_id, category_id);
        assert!(rule.id > 0);
    }

    #[test]
    fn list_returns_rules_ordered_by_priority() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Contains, "b", category_id, 5)
            .expect("create rule");
        create(&conn, RuleField::Description, MatchType::Contains, "a", category_id, 1)
            .expect("create rule");

        let rules = list(&conn).expect("list rules");

        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].match_value, "a");
        assert_eq!(rules[1].match_value, "b");
    }

    #[test]
    fn update_changes_the_stored_fields() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let created = create(&conn, RuleField::Description, MatchType::Contains, "old", category_id, 0)
            .expect("create rule");

        let updated = update(
            &conn,
            created.id,
            RuleField::Description,
            MatchType::Equals,
            "new",
            category_id,
            2,
        )
        .expect("update rule");

        assert_eq!(updated.match_value, "new");
        assert_eq!(updated.match_type, MatchType::Equals);
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_fails_when_the_rule_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");

        let result = update(&conn, 999, RuleField::Description, MatchType::Contains, "x", category_id, 0);

        assert!(result.is_err());
    }

    #[test]
    fn delete_removes_the_rule() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let created = create(&conn, RuleField::Description, MatchType::Contains, "x", category_id, 0)
            .expect("create rule");

        delete(&conn, created.id).expect("delete rule");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_fails_when_the_rule_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn deleting_the_category_cascades_to_its_rules() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let created = create(&conn, RuleField::Description, MatchType::Contains, "x", category_id, 0)
            .expect("create rule");

        categories::delete(&conn, category_id).expect("delete category");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn description_contains_matches_case_insensitively() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Contains, "WHOLE FOODS", category_id, 0)
            .expect("create rule");

        let result = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -500, "Whole Foods Market #42", None)
            .expect("apply rule");

        assert_eq!(result, Some(category_id));
    }

    #[test]
    fn description_equals_requires_exact_match() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Equals, "Rent", category_id, 0)
            .expect("create rule");

        let no_match = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -500, "Rent payment", None).expect("apply rule");
        let exact_match = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -500, "rent", None).expect("apply rule");

        assert_eq!(no_match, None);
        assert_eq!(exact_match, Some(category_id));
    }

    #[test]
    fn amount_field_matches_on_stringified_cents_equality() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Subscriptions");
        create(&conn, RuleField::Amount, MatchType::Equals, "-1599", category_id, 0)
            .expect("create rule");

        let matches = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -1599, "Streaming Co", None).expect("apply rule");
        let no_match = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -1600, "Streaming Co", None).expect("apply rule");

        assert_eq!(matches, Some(category_id));
        assert_eq!(no_match, None);
    }

    #[test]
    fn account_field_matches_on_account_id_equality() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Business");
        create(&conn, RuleField::Account, MatchType::Equals, "7", category_id, 0)
            .expect("create rule");

        let matches = apply_to_transaction_with_merchant(&conn, 7, "2026-08-01", -500, "Anything", None).expect("apply rule");
        let no_match = apply_to_transaction_with_merchant(&conn, 8, "2026-08-01", -500, "Anything", None).expect("apply rule");

        assert_eq!(matches, Some(category_id));
        assert_eq!(no_match, None);
    }

    #[test]
    fn apply_to_transaction_with_merchant_prefers_merchant_name_over_raw_description() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Coffee");
        create(&conn, RuleField::Description, MatchType::Equals, "blue bottle coffee", category_id, 0)
            .expect("create rule");

        // The rule only matches the clean merchant name, not the raw
        // processor-prefixed description.
        let via_merchant = apply_to_transaction_with_merchant(
            &conn,
            1,
            "2026-08-01",
            -500,
            "SQ *BLUE BOTTLE COF 04/12",
            Some("blue bottle coffee"),
        )
        .expect("apply rule");
        let without_merchant = apply_to_transaction_with_merchant(
            &conn,
            1,
            "2026-08-01",
            -500,
            "SQ *BLUE BOTTLE COF 04/12",
            None,
        )
        .expect("apply rule");

        assert_eq!(via_merchant, Some(category_id));
        assert_eq!(without_merchant, None);
    }

    #[test]
    fn no_matching_rule_returns_none() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Contains, "grocery", category_id, 0)
            .expect("create rule");

        let result = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -500, "Movie Theater", None).expect("apply rule");

        assert_eq!(result, None);
    }

    #[test]
    fn when_multiple_rules_match_the_lowest_priority_wins() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let low_priority_category = create_test_category(&conn, "Specific");
        let high_priority_category = create_test_category(&conn, "General");
        // Both rules match "Coffee Shop"; priority 0 should win over priority 5.
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "coffee",
            low_priority_category,
            0,
        )
        .expect("create rule");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "shop",
            high_priority_category,
            5,
        )
        .expect("create rule");

        let result = apply_to_transaction_with_merchant(&conn, 1, "2026-08-01", -500, "Coffee Shop", None).expect("apply rule");

        assert_eq!(result, Some(low_priority_category));
    }

    #[test]
    fn apply_to_uncategorized_updates_only_transactions_missing_a_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        create(&conn, RuleField::Description, MatchType::Contains, "grocery", category_id, 0)
            .expect("create rule");

        let uncategorized = transactions::create(&conn, account_id, "2026-08-01", -500, "Grocery Store", None)
            .expect("create transaction");
        let already_categorized = transactions::create(
            &conn,
            account_id,
            "2026-08-02",
            -600,
            "Grocery Store Too",
            Some(category_id),
        )
        .expect("create transaction");
        let non_matching = transactions::create(&conn, account_id, "2026-08-03", -700, "Movie Theater", None)
            .expect("create transaction");

        let updated_count = apply_to_uncategorized(&conn, None).expect("apply to uncategorized");

        assert_eq!(updated_count, 1);
        assert_eq!(
            transactions::get(&conn, uncategorized.id).unwrap().unwrap().category_id,
            Some(category_id)
        );
        assert_eq!(
            transactions::get(&conn, already_categorized.id).unwrap().unwrap().category_id,
            Some(category_id)
        );
        assert_eq!(transactions::get(&conn, non_matching.id).unwrap().unwrap().category_id, None);
    }

    #[test]
    fn apply_to_uncategorized_can_be_scoped_to_one_account() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let account_a = crate::services::accounts::create(
            &conn,
            "Checking A",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        let account_b = crate::services::accounts::create(
            &conn,
            "Checking B",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        create(&conn, RuleField::Description, MatchType::Contains, "grocery", category_id, 0)
            .expect("create rule");
        let txn_a = transactions::create(&conn, account_a, "2026-08-01", -500, "Grocery Store", None)
            .expect("create transaction");
        let txn_b = transactions::create(&conn, account_b, "2026-08-01", -500, "Grocery Store", None)
            .expect("create transaction");

        let updated_count = apply_to_uncategorized(&conn, Some(account_a)).expect("apply to uncategorized");

        assert_eq!(updated_count, 1);
        assert_eq!(transactions::get(&conn, txn_a.id).unwrap().unwrap().category_id, Some(category_id));
        assert_eq!(transactions::get(&conn, txn_b.id).unwrap().unwrap().category_id, None);
    }
}

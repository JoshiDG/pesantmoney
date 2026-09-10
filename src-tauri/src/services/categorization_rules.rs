//! Categorization Rules: a user-defined condition (matching on Transaction
//! description, amount, or Account) that applies a small set of independent
//! actions to matching Transactions, automatically, on Import (see
//! CONTEXT.md). Entirely local — no cloud merchant lookup.
//!
//! A rule's action used to be exactly one thing (assign a category). It has
//! grown into a set of *optional, independent* actions -- assign a
//! `category_id` (#unchanged), rename the merchant (issue #37), hide the
//! Transaction (issue #39), and attach one or more Tags (issue #38) -- any
//! combination of which may be present on a single rule, as long as at least
//! one is. This is represented by `RuleActions` (what a caller configures on
//! create/update) and mirrored on `CategorizationRule` (what's stored) and
//! `RuleEffects` (what a single match produces, ready to apply to a
//! Transaction). All three action-bearing shapes share the same fields so
//! adding a fourth action later means extending one shape, not three ad hoc
//! branches through the rule-application pass.

use rusqlite::{params, Connection};
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::fmt;

use crate::services::tags;

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

/// The set of actions a Categorization Rule applies to a Transaction it
/// matches. Every field is independently optional/empty; `create`/`update`
/// reject a `RuleActions` where all of them are (a rule that would do
/// nothing on match isn't valid).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RuleActions {
    pub category_id: Option<i64>,
    pub rename_value: Option<String>,
    #[serde(default)]
    pub hide: bool,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

impl RuleActions {
    pub fn is_empty(&self) -> bool {
        self.category_id.is_none() && self.rename_value.is_none() && !self.hide && self.tag_ids.is_empty()
    }
}

/// Errors specific to creating/updating a Categorization Rule. Kept separate
/// from `rusqlite::Error` because `NoAction` is a domain validation failure
/// (bad input), not a database failure.
#[derive(Debug)]
pub enum RuleError {
    /// A rule with no category, no rename value, no hide, and no tags would
    /// do nothing on match -- rejected rather than silently stored as a
    /// dead rule.
    NoAction,
    NotFound(i64),
    Db(rusqlite::Error),
}

impl fmt::Display for RuleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RuleError::NoAction => write!(
                f,
                "a rule must configure at least one action: category, rename, hide, or tags"
            ),
            RuleError::NotFound(id) => write!(f, "rule {id} does not exist"),
            RuleError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl From<rusqlite::Error> for RuleError {
    fn from(e: rusqlite::Error) -> Self {
        RuleError::Db(e)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CategorizationRule {
    pub id: i64,
    pub field: RuleField,
    pub match_type: MatchType,
    pub match_value: String,
    pub category_id: Option<i64>,
    pub rename_value: Option<String>,
    pub hide: bool,
    pub tag_ids: Vec<i64>,
    pub priority: i64,
}

/// (id, field, match_type, match_value, category_id, rename_value, hide, priority)
type RuleRow = (i64, RuleField, MatchType, String, Option<i64>, Option<String>, bool, i64);

fn rule_from_row(row: &rusqlite::Row) -> rusqlite::Result<RuleRow> {
    let field_str: String = row.get(1)?;
    let field = RuleField::from_str(&field_str)
        .ok_or_else(|| rusqlite::Error::InvalidColumnType(1, "field".into(), rusqlite::types::Type::Text))?;
    let match_type_str: String = row.get(2)?;
    let match_type = MatchType::from_str(&match_type_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(2, "match_type".into(), rusqlite::types::Type::Text)
    })?;

    Ok((
        row.get(0)?,
        field,
        match_type,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
    ))
}

const SELECT_COLUMNS: &str = "id, field, match_type, match_value, category_id, rename_value, hide, priority";

fn tag_ids_for_rule(conn: &Connection, rule_id: i64) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT tag_id FROM categorization_rule_tags WHERE rule_id = ?1 ORDER BY tag_id",
    )?;
    let rows = stmt.query_map([rule_id], |row| row.get(0))?;
    rows.collect()
}

fn set_tag_ids_for_rule(conn: &Connection, rule_id: i64, tag_ids: &[i64]) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM categorization_rule_tags WHERE rule_id = ?1",
        params![rule_id],
    )?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT OR IGNORE INTO categorization_rule_tags (rule_id, tag_id) VALUES (?1, ?2)",
            params![rule_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn create(
    conn: &Connection,
    field: RuleField,
    match_type: MatchType,
    match_value: &str,
    actions: RuleActions,
    priority: i64,
) -> Result<CategorizationRule, RuleError> {
    if actions.is_empty() {
        return Err(RuleError::NoAction);
    }

    conn.execute(
        "INSERT INTO categorization_rules \
         (field, match_type, match_value, category_id, rename_value, hide, priority) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            field.as_str(),
            match_type.as_str(),
            match_value,
            actions.category_id,
            actions.rename_value,
            actions.hide,
            priority
        ],
    )?;
    let id = conn.last_insert_rowid();
    set_tag_ids_for_rule(conn, id, &actions.tag_ids)?;

    Ok(CategorizationRule {
        id,
        field,
        match_type,
        match_value: match_value.to_string(),
        category_id: actions.category_id,
        rename_value: actions.rename_value,
        hide: actions.hide,
        tag_ids: actions.tag_ids,
        priority,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<CategorizationRule>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM categorization_rules ORDER BY priority, id"
    ))?;
    let rows = stmt.query_map([], rule_from_row)?;
    let mut rules = Vec::new();
    for row in rows {
        let (id, field, match_type, match_value, category_id, rename_value, hide, priority) = row?;
        let tag_ids = tag_ids_for_rule(conn, id)?;
        rules.push(CategorizationRule {
            id,
            field,
            match_type,
            match_value,
            category_id,
            rename_value,
            hide,
            tag_ids,
            priority,
        });
    }
    Ok(rules)
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<CategorizationRule>> {
    let row = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM categorization_rules WHERE id = ?1"),
            [id],
            rule_from_row,
        )
        .optional()?;
    let Some((id, field, match_type, match_value, category_id, rename_value, hide, priority)) = row else {
        return Ok(None);
    };
    let tag_ids = tag_ids_for_rule(conn, id)?;
    Ok(Some(CategorizationRule {
        id,
        field,
        match_type,
        match_value,
        category_id,
        rename_value,
        hide,
        tag_ids,
        priority,
    }))
}

pub fn update(
    conn: &Connection,
    id: i64,
    field: RuleField,
    match_type: MatchType,
    match_value: &str,
    actions: RuleActions,
    priority: i64,
) -> Result<CategorizationRule, RuleError> {
    if actions.is_empty() {
        return Err(RuleError::NoAction);
    }

    let rows_affected = conn.execute(
        "UPDATE categorization_rules SET field = ?1, match_type = ?2, match_value = ?3, \
         category_id = ?4, rename_value = ?5, hide = ?6, priority = ?7, updated_at = datetime('now') \
         WHERE id = ?8",
        params![
            field.as_str(),
            match_type.as_str(),
            match_value,
            actions.category_id,
            actions.rename_value,
            actions.hide,
            priority,
            id
        ],
    )?;
    if rows_affected == 0 {
        return Err(RuleError::NotFound(id));
    }
    set_tag_ids_for_rule(conn, id, &actions.tag_ids)?;

    Ok(CategorizationRule {
        id,
        field,
        match_type,
        match_value: match_value.to_string(),
        category_id: actions.category_id,
        rename_value: actions.rename_value,
        hide: actions.hide,
        tag_ids: actions.tag_ids,
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

/// The actions produced by matching a Transaction against the rule set,
/// ready to be applied. All fields default to "no effect" -- callers apply
/// each field independently (assign category if `Some`, rename if `Some`,
/// hide if `true`, attach each of `tag_ids`) rather than branching on
/// "which single action did this rule have".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RuleEffects {
    pub category_id: Option<i64>,
    pub rename_value: Option<String>,
    pub hide: bool,
    pub tag_ids: Vec<i64>,
}

/// Returns the actions of the first matching rule (by priority, lower runs
/// first), or `RuleEffects::default()` (no effect) if no rule matches this
/// Transaction. Only the single highest-priority matching rule's actions
/// apply -- actions from multiple matching rules are not merged, matching
/// the existing "first match wins" semantics for category assignment.
pub fn apply_to_transaction(
    conn: &Connection,
    account_id: i64,
    _date: &str,
    amount_cents: i64,
    description: &str,
) -> rusqlite::Result<RuleEffects> {
    let rules = list(conn)?;
    Ok(rules
        .iter()
        .find(|rule| rule_matches(rule, account_id, amount_cents, description))
        .map(|rule| RuleEffects {
            category_id: rule.category_id,
            rename_value: rule.rename_value.clone(),
            hide: rule.hide,
            tag_ids: rule.tag_ids.clone(),
        })
        .unwrap_or_default())
}

/// Backfill: scans existing Transactions with `category_id IS NULL`,
/// optionally scoped to one Account, applies matching rules (category,
/// rename, hide, and tags alike), and returns the count of Transactions a
/// rule actually applied an effect to.
pub fn apply_to_uncategorized(conn: &Connection, account_id: Option<i64>) -> rusqlite::Result<usize> {
    struct UncategorizedTransaction {
        id: i64,
        account_id: i64,
        date: String,
        amount_cents: i64,
        description: String,
    }

    let mut stmt = match account_id {
        Some(_) => conn.prepare(
            "SELECT id, account_id, date, amount_cents, description FROM transactions \
             WHERE category_id IS NULL AND account_id = ?1",
        )?,
        None => conn.prepare(
            "SELECT id, account_id, date, amount_cents, description FROM transactions \
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
        })
    };

    let transactions: Vec<UncategorizedTransaction> = match account_id {
        Some(id) => stmt.query_map([id], row_mapper)?.collect::<rusqlite::Result<_>>()?,
        None => stmt.query_map([], row_mapper)?.collect::<rusqlite::Result<_>>()?,
    };

    let mut updated_count = 0;
    for txn in transactions {
        let effects = apply_to_transaction(conn, txn.account_id, &txn.date, txn.amount_cents, &txn.description)?;
        if effects.category_id.is_none() && effects.rename_value.is_none() && !effects.hide && effects.tag_ids.is_empty()
        {
            continue;
        }

        if let Some(category_id) = effects.category_id {
            conn.execute(
                "UPDATE transactions SET category_id = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![category_id, txn.id],
            )?;
        }
        if let Some(rename_value) = &effects.rename_value {
            conn.execute(
                "UPDATE transactions SET merchant_name = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![rename_value, txn.id],
            )?;
        }
        if effects.hide {
            conn.execute(
                "UPDATE transactions SET hidden = 1, updated_at = datetime('now') WHERE id = ?1",
                params![txn.id],
            )?;
        }
        for tag_id in &effects.tag_ids {
            tags::attach(conn, txn.id, *tag_id)?;
        }
        updated_count += 1;
    }

    Ok(updated_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::categories;
    use crate::services::tags;
    use crate::services::transactions;

    fn create_test_category(conn: &Connection, name: &str) -> i64 {
        let group_id = categories::create_group(conn, "Test Group").expect("create group").id;
        categories::create(conn, group_id, name).expect("create category").id
    }

    fn category_only(category_id: i64) -> RuleActions {
        RuleActions {
            category_id: Some(category_id),
            ..Default::default()
        }
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
            category_only(category_id),
            0,
        )
        .expect("create rule");

        assert_eq!(rule.match_value, "grocery");
        assert_eq!(rule.category_id, Some(category_id));
        assert!(rule.id > 0);
    }

    #[test]
    fn create_rejects_a_rule_with_no_action() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "grocery",
            RuleActions::default(),
            0,
        );

        assert!(matches!(result, Err(RuleError::NoAction)));
    }

    #[test]
    fn create_accepts_a_rename_only_rule_with_no_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let rule = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "sbux",
            RuleActions {
                rename_value: Some("Starbucks".to_string()),
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        assert_eq!(rule.category_id, None);
        assert_eq!(rule.rename_value, Some("Starbucks".to_string()));
    }

    #[test]
    fn create_accepts_a_hide_only_rule() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let rule = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "atm fee",
            RuleActions {
                hide: true,
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        assert_eq!(rule.category_id, None);
        assert!(rule.hide);
    }

    #[test]
    fn create_accepts_a_tag_only_rule() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let tag = tags::get_or_create(&conn, "Reimbursable").expect("create tag");

        let rule = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "uber",
            RuleActions {
                tag_ids: vec![tag.id],
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        assert_eq!(rule.tag_ids, vec![tag.id]);
    }

    #[test]
    fn create_accepts_a_rule_combining_every_action() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Travel");
        let tag = tags::get_or_create(&conn, "Vacation").expect("create tag");

        let rule = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "airline",
            RuleActions {
                category_id: Some(category_id),
                rename_value: Some("Airline Co".to_string()),
                hide: true,
                tag_ids: vec![tag.id],
            },
            0,
        )
        .expect("create rule");

        assert_eq!(rule.category_id, Some(category_id));
        assert_eq!(rule.rename_value, Some("Airline Co".to_string()));
        assert!(rule.hide);
        assert_eq!(rule.tag_ids, vec![tag.id]);
    }

    #[test]
    fn list_returns_rules_ordered_by_priority() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Contains, "b", category_only(category_id), 5)
            .expect("create rule");
        create(&conn, RuleField::Description, MatchType::Contains, "a", category_only(category_id), 1)
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
        let created = create(&conn, RuleField::Description, MatchType::Contains, "old", category_only(category_id), 0)
            .expect("create rule");

        let updated = update(
            &conn,
            created.id,
            RuleField::Description,
            MatchType::Equals,
            "new",
            category_only(category_id),
            2,
        )
        .expect("update rule");

        assert_eq!(updated.match_value, "new");
        assert_eq!(updated.match_type, MatchType::Equals);
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_can_change_the_rules_tags() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let tag_a = tags::get_or_create(&conn, "A").expect("create tag");
        let tag_b = tags::get_or_create(&conn, "B").expect("create tag");
        let created = create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "x",
            RuleActions {
                tag_ids: vec![tag_a.id],
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        let updated = update(
            &conn,
            created.id,
            RuleField::Description,
            MatchType::Contains,
            "x",
            RuleActions {
                tag_ids: vec![tag_b.id],
                ..Default::default()
            },
            0,
        )
        .expect("update rule");

        assert_eq!(updated.tag_ids, vec![tag_b.id]);
    }

    #[test]
    fn update_rejects_removing_every_action() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let created = create(&conn, RuleField::Description, MatchType::Contains, "old", category_only(category_id), 0)
            .expect("create rule");

        let result = update(
            &conn,
            created.id,
            RuleField::Description,
            MatchType::Contains,
            "old",
            RuleActions::default(),
            0,
        );

        assert!(matches!(result, Err(RuleError::NoAction)));
    }

    #[test]
    fn update_fails_when_the_rule_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");

        let result = update(
            &conn,
            999,
            RuleField::Description,
            MatchType::Contains,
            "x",
            category_only(category_id),
            0,
        );

        assert!(matches!(result, Err(RuleError::NotFound(999))));
    }

    #[test]
    fn delete_removes_the_rule() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        let created = create(&conn, RuleField::Description, MatchType::Contains, "x", category_only(category_id), 0)
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
        let created = create(&conn, RuleField::Description, MatchType::Contains, "x", category_only(category_id), 0)
            .expect("create rule");

        categories::delete(&conn, category_id).expect("delete category");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn description_contains_matches_case_insensitively() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Contains, "WHOLE FOODS", category_only(category_id), 0)
            .expect("create rule");

        let result = apply_to_transaction(&conn, 1, "2026-08-01", -500, "Whole Foods Market #42")
            .expect("apply rule");

        assert_eq!(result.category_id, Some(category_id));
    }

    #[test]
    fn description_equals_requires_exact_match() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Equals, "Rent", category_only(category_id), 0)
            .expect("create rule");

        let no_match = apply_to_transaction(&conn, 1, "2026-08-01", -500, "Rent payment").expect("apply rule");
        let exact_match = apply_to_transaction(&conn, 1, "2026-08-01", -500, "rent").expect("apply rule");

        assert_eq!(no_match.category_id, None);
        assert_eq!(exact_match.category_id, Some(category_id));
    }

    #[test]
    fn amount_field_matches_on_stringified_cents_equality() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Subscriptions");
        create(&conn, RuleField::Amount, MatchType::Equals, "-1599", category_only(category_id), 0)
            .expect("create rule");

        let matches = apply_to_transaction(&conn, 1, "2026-08-01", -1599, "Streaming Co").expect("apply rule");
        let no_match = apply_to_transaction(&conn, 1, "2026-08-01", -1600, "Streaming Co").expect("apply rule");

        assert_eq!(matches.category_id, Some(category_id));
        assert_eq!(no_match.category_id, None);
    }

    #[test]
    fn account_field_matches_on_account_id_equality() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Business");
        create(&conn, RuleField::Account, MatchType::Equals, "7", category_only(category_id), 0)
            .expect("create rule");

        let matches = apply_to_transaction(&conn, 7, "2026-08-01", -500, "Anything").expect("apply rule");
        let no_match = apply_to_transaction(&conn, 8, "2026-08-01", -500, "Anything").expect("apply rule");

        assert_eq!(matches.category_id, Some(category_id));
        assert_eq!(no_match.category_id, None);
    }

    #[test]
    fn no_matching_rule_returns_no_effects() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Groceries");
        create(&conn, RuleField::Description, MatchType::Contains, "grocery", category_only(category_id), 0)
            .expect("create rule");

        let result = apply_to_transaction(&conn, 1, "2026-08-01", -500, "Movie Theater").expect("apply rule");

        assert_eq!(result, RuleEffects::default());
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
            category_only(low_priority_category),
            0,
        )
        .expect("create rule");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "shop",
            category_only(high_priority_category),
            5,
        )
        .expect("create rule");

        let result = apply_to_transaction(&conn, 1, "2026-08-01", -500, "Coffee Shop").expect("apply rule");

        assert_eq!(result.category_id, Some(low_priority_category));
    }

    // --- #37: rename merchant on match ---

    #[test]
    fn a_matching_rename_rule_produces_the_rename_value_and_no_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "sbux",
            RuleActions {
                rename_value: Some("Starbucks".to_string()),
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        let effects = apply_to_transaction(&conn, 1, "2026-08-01", -500, "SBUX #1234").expect("apply rule");

        assert_eq!(effects.rename_value, Some("Starbucks".to_string()));
        assert_eq!(effects.category_id, None);
    }

    #[test]
    fn a_rule_can_both_categorize_and_rename_on_the_same_match() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Coffee");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "sbux",
            RuleActions {
                category_id: Some(category_id),
                rename_value: Some("Starbucks".to_string()),
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        let effects = apply_to_transaction(&conn, 1, "2026-08-01", -500, "SBUX #1234").expect("apply rule");

        assert_eq!(effects.category_id, Some(category_id));
        assert_eq!(effects.rename_value, Some("Starbucks".to_string()));
    }

    #[test]
    fn commit_import_applies_a_rename_only_rule_to_merchant_name_not_description() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "sbux",
            RuleActions {
                rename_value: Some("Starbucks".to_string()),
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        let result = crate::import::commit_import(
            &conn,
            account_id,
            vec![crate::import::ParsedTransaction {
                date: "2026-08-01".to_string(),
                amount_cents: -500,
                description: "SBUX #1234".to_string(),
                category_id: None,
            }],
        )
        .expect("commit import");
        assert_eq!(result.imported_count, 1);

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].description, "SBUX #1234");
        assert_eq!(stored[0].merchant_name, Some("Starbucks".to_string()));
    }

    // --- #39: hide transaction on match ---

    #[test]
    fn a_matching_hide_rule_produces_hide_true_with_no_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "atm fee",
            RuleActions {
                hide: true,
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        let effects = apply_to_transaction(&conn, 1, "2026-08-01", -300, "ATM Fee").expect("apply rule");

        assert!(effects.hide);
        assert_eq!(effects.category_id, None);
    }

    #[test]
    fn commit_import_hides_the_transaction_when_a_hide_rule_matches() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "atm fee",
            RuleActions {
                hide: true,
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        crate::import::commit_import(
            &conn,
            account_id,
            vec![crate::import::ParsedTransaction {
                date: "2026-08-01".to_string(),
                amount_cents: -300,
                description: "ATM Fee".to_string(),
                category_id: None,
            }],
        )
        .expect("commit import");

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored.len(), 1);
        assert!(stored[0].hidden);

        // Excluded from the default (visible-only) list view...
        let visible = transactions::list_visible_for_account(&conn, account_id, false)
            .expect("list visible transactions");
        assert!(visible.is_empty());

        // ...but can be manually unhidden regardless of the rule.
        transactions::set_hidden(&conn, stored[0].id, false).expect("unhide transaction");
        let visible_after_unhide = transactions::list_visible_for_account(&conn, account_id, false)
            .expect("list visible transactions");
        assert_eq!(visible_after_unhide.len(), 1);
    }

    // --- #38: attach tags on match ---

    #[test]
    fn a_matching_tag_rule_produces_its_tag_ids_with_no_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let tag = tags::get_or_create(&conn, "Reimbursable").expect("create tag");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "uber",
            RuleActions {
                tag_ids: vec![tag.id],
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        let effects = apply_to_transaction(&conn, 1, "2026-08-01", -1200, "Uber Trip").expect("apply rule");

        assert_eq!(effects.tag_ids, vec![tag.id]);
        assert_eq!(effects.category_id, None);
    }

    #[test]
    fn commit_import_attaches_the_rules_tags_to_the_matched_transaction() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        let tag = tags::get_or_create(&conn, "Reimbursable").expect("create tag");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "uber",
            RuleActions {
                tag_ids: vec![tag.id],
                ..Default::default()
            },
            0,
        )
        .expect("create rule");

        crate::import::commit_import(
            &conn,
            account_id,
            vec![crate::import::ParsedTransaction {
                date: "2026-08-01".to_string(),
                amount_cents: -1200,
                description: "Uber Trip".to_string(),
                category_id: None,
            }],
        )
        .expect("commit import");

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        let attached = tags::list_for_transaction(&conn, stored[0].id).expect("list tags for transaction");
        assert_eq!(attached, vec![tag]);
    }

    #[test]
    fn commit_import_does_not_duplicate_tag_attachment_on_re_import_of_the_same_row() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        let tag = tags::get_or_create(&conn, "Reimbursable").expect("create tag");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "uber",
            RuleActions {
                tag_ids: vec![tag.id],
                ..Default::default()
            },
            0,
        )
        .expect("create rule");
        let row = crate::import::ParsedTransaction {
            date: "2026-08-01".to_string(),
            amount_cents: -1200,
            description: "Uber Trip".to_string(),
            category_id: None,
        };
        crate::import::commit_import(&conn, account_id, vec![row.clone()]).expect("commit import");
        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");

        // Manually re-applying the same rule effect (simulating a rerun of
        // rule application against the already-imported transaction) must
        // not create a second attachment.
        tags::attach(&conn, stored[0].id, tag.id).expect("attach tag again");

        let attached = tags::list_for_transaction(&conn, stored[0].id).expect("list tags for transaction");
        assert_eq!(attached.len(), 1);
    }

    // --- combined actions on one rule ---

    #[test]
    fn a_single_rule_can_categorize_rename_hide_and_tag_together() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let category_id = create_test_category(&conn, "Fees");
        let tag = tags::get_or_create(&conn, "Bank Fee").expect("create tag");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "atm fee",
            RuleActions {
                category_id: Some(category_id),
                rename_value: Some("Bank ATM Fee".to_string()),
                hide: true,
                tag_ids: vec![tag.id],
            },
            0,
        )
        .expect("create rule");

        let effects = apply_to_transaction(&conn, 1, "2026-08-01", -300, "ATM Fee").expect("apply rule");

        assert_eq!(effects.category_id, Some(category_id));
        assert_eq!(effects.rename_value, Some("Bank ATM Fee".to_string()));
        assert!(effects.hide);
        assert_eq!(effects.tag_ids, vec![tag.id]);
    }

    #[test]
    fn commit_import_applies_every_action_of_a_combined_rule_to_one_transaction() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        let category_id = create_test_category(&conn, "Fees");
        let tag = tags::get_or_create(&conn, "Bank Fee").expect("create tag");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "atm fee",
            RuleActions {
                category_id: Some(category_id),
                rename_value: Some("Bank ATM Fee".to_string()),
                hide: true,
                tag_ids: vec![tag.id],
            },
            0,
        )
        .expect("create rule");

        crate::import::commit_import(
            &conn,
            account_id,
            vec![crate::import::ParsedTransaction {
                date: "2026-08-01".to_string(),
                amount_cents: -300,
                description: "ATM Fee".to_string(),
                category_id: None,
            }],
        )
        .expect("commit import");

        let stored = transactions::list_for_account(&conn, account_id).expect("list transactions");
        assert_eq!(stored.len(), 1);
        let txn = &stored[0];
        assert_eq!(txn.category_id, Some(category_id));
        assert_eq!(txn.merchant_name, Some("Bank ATM Fee".to_string()));
        assert!(txn.hidden);
        assert_eq!(
            tags::list_for_transaction(&conn, txn.id).expect("list tags for transaction"),
            vec![tag]
        );
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
        create(&conn, RuleField::Description, MatchType::Contains, "grocery", category_only(category_id), 0)
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
        create(&conn, RuleField::Description, MatchType::Contains, "grocery", category_only(category_id), 0)
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

    #[test]
    fn apply_to_uncategorized_also_applies_hide_and_tag_actions() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = crate::services::accounts::create(
            &conn,
            "Checking",
            crate::services::accounts::AccountType::Checking,
            None,
        )
        .expect("create account")
        .id;
        let tag = tags::get_or_create(&conn, "Fee").expect("create tag");
        create(
            &conn,
            RuleField::Description,
            MatchType::Contains,
            "atm fee",
            RuleActions {
                hide: true,
                tag_ids: vec![tag.id],
                ..Default::default()
            },
            0,
        )
        .expect("create rule");
        let txn = transactions::create(&conn, account_id, "2026-08-01", -300, "ATM Fee", None)
            .expect("create transaction");

        let updated_count = apply_to_uncategorized(&conn, None).expect("apply to uncategorized");

        assert_eq!(updated_count, 1);
        assert!(transactions::get(&conn, txn.id).unwrap().unwrap().hidden);
        assert_eq!(tags::list_for_transaction(&conn, txn.id).expect("list tags"), vec![tag]);
    }
}

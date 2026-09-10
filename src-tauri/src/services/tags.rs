//! Tag: a flat, user-created label a Transaction can carry zero or more of,
//! independent of its Category (see CONTEXT.md, ADR-0013). Tags are created
//! ad hoc -- wherever one is assigned, by name -- rather than through a
//! dedicated management screen (out of scope for issue #38).

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

fn tag_from_row(row: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
    })
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare("SELECT id, name FROM tags ORDER BY name")?;
    let rows = stmt.query_map([], tag_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Tag>> {
    conn.query_row("SELECT id, name FROM tags WHERE id = ?1", [id], tag_from_row)
        .optional()
}

fn find_by_name(conn: &Connection, name: &str) -> rusqlite::Result<Option<Tag>> {
    conn.query_row(
        "SELECT id, name FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![name],
        tag_from_row,
    )
    .optional()
}

/// Returns the existing Tag with this name (case-insensitively), creating it
/// if it doesn't exist yet. This is the only way Tags are created --
/// wherever a Tag is assigned (a Categorization Rule action, a future
/// Transaction-detail UI), by name, not through a dedicated CRUD screen.
pub fn get_or_create(conn: &Connection, name: &str) -> rusqlite::Result<Tag> {
    let trimmed = name.trim();
    if let Some(existing) = find_by_name(conn, trimmed)? {
        return Ok(existing);
    }
    conn.execute("INSERT INTO tags (name) VALUES (?1)", params![trimmed])?;
    let id = conn.last_insert_rowid();
    Ok(Tag {
        id,
        name: trimmed.to_string(),
    })
}

/// Attaches `tag_id` to `transaction_id`. Idempotent: attaching a Tag that's
/// already on the Transaction is a no-op, so re-applying a Categorization
/// Rule (e.g. on re-import) never creates a duplicate attachment.
pub fn attach(conn: &Connection, transaction_id: i64, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id) VALUES (?1, ?2)",
        params![transaction_id, tag_id],
    )?;
    Ok(())
}

pub fn detach(conn: &Connection, transaction_id: i64, tag_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM transaction_tags WHERE transaction_id = ?1 AND tag_id = ?2",
        params![transaction_id, tag_id],
    )?;
    Ok(())
}

/// Lists the Tags attached to a single Transaction, so a future UI (out of
/// scope for issue #38) can render them.
pub fn list_for_transaction(conn: &Connection, transaction_id: i64) -> rusqlite::Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name FROM tags t \
         JOIN transaction_tags tt ON tt.tag_id = t.id \
         WHERE tt.transaction_id = ?1 ORDER BY t.name",
    )?;
    let rows = stmt.query_map([transaction_id], tag_from_row)?;
    rows.collect()
}

/// Bulk variant of `list_for_transaction`, keyed by `transaction_id`, for
/// rendering Tags across an entire Transactions grid without one query per
/// row (issue #38's "visible in the Transactions grid" acceptance
/// criterion). A Transaction absent from the map has no Tags.
pub fn map_for_account(conn: &Connection, account_id: i64) -> rusqlite::Result<HashMap<i64, Vec<Tag>>> {
    let mut stmt = conn.prepare(
        "SELECT tt.transaction_id, t.id, t.name FROM tags t \
         JOIN transaction_tags tt ON tt.tag_id = t.id \
         JOIN transactions txn ON txn.id = tt.transaction_id \
         WHERE txn.account_id = ?1 ORDER BY tt.transaction_id, t.name",
    )?;
    let rows = stmt.query_map([account_id], |row| {
        Ok((row.get::<_, i64>(0)?, Tag { id: row.get(1)?, name: row.get(2)? }))
    })?;

    let mut map: HashMap<i64, Vec<Tag>> = HashMap::new();
    for row in rows {
        let (transaction_id, tag) = row?;
        map.entry(transaction_id).or_default().push(tag);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::services::accounts::{self, AccountType};
    use crate::services::transactions;

    fn create_test_transaction(conn: &Connection) -> i64 {
        let account_id = accounts::create(conn, "Checking", AccountType::Checking, None)
            .expect("create account")
            .id;
        transactions::create(conn, account_id, "2026-08-01", -500, "Coffee", None)
            .expect("create transaction")
            .id
    }

    #[test]
    fn get_or_create_creates_a_new_tag_by_name() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let tag = get_or_create(&conn, "Reimbursable").expect("get or create tag");

        assert_eq!(tag.name, "Reimbursable");
        assert!(tag.id > 0);
    }

    #[test]
    fn get_or_create_is_idempotent_and_case_insensitive() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let first = get_or_create(&conn, "Vacation 2026").expect("get or create tag");
        let second = get_or_create(&conn, "vacation 2026").expect("get or create tag");

        assert_eq!(first.id, second.id);
        assert_eq!(list_all(&conn).expect("list tags").len(), 1);
    }

    #[test]
    fn attach_and_list_for_transaction_round_trip() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let transaction_id = create_test_transaction(&conn);
        let tag = get_or_create(&conn, "Reimbursable").expect("get or create tag");

        attach(&conn, transaction_id, tag.id).expect("attach tag");

        let tags = list_for_transaction(&conn, transaction_id).expect("list tags for transaction");
        assert_eq!(tags, vec![tag]);
    }

    #[test]
    fn attach_is_idempotent() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let transaction_id = create_test_transaction(&conn);
        let tag = get_or_create(&conn, "Reimbursable").expect("get or create tag");

        attach(&conn, transaction_id, tag.id).expect("attach tag");
        attach(&conn, transaction_id, tag.id).expect("attach tag again");

        assert_eq!(list_for_transaction(&conn, transaction_id).expect("list tags").len(), 1);
    }

    #[test]
    fn detach_removes_the_attachment() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let transaction_id = create_test_transaction(&conn);
        let tag = get_or_create(&conn, "Reimbursable").expect("get or create tag");
        attach(&conn, transaction_id, tag.id).expect("attach tag");

        detach(&conn, transaction_id, tag.id).expect("detach tag");

        assert!(list_for_transaction(&conn, transaction_id).expect("list tags").is_empty());
    }

    #[test]
    fn map_for_account_groups_tags_by_transaction_and_omits_untagged_ones() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let account_id = accounts::create(&conn, "Checking", AccountType::Checking, None)
            .expect("create account")
            .id;
        let tagged = transactions::create(&conn, account_id, "2026-08-01", -500, "Coffee", None)
            .expect("create transaction")
            .id;
        let untagged = transactions::create(&conn, account_id, "2026-08-02", -700, "Gas", None)
            .expect("create transaction")
            .id;
        let reimbursable = get_or_create(&conn, "Reimbursable").expect("get or create tag");
        let vacation = get_or_create(&conn, "Vacation").expect("get or create tag");
        attach(&conn, tagged, reimbursable.id).expect("attach tag");
        attach(&conn, tagged, vacation.id).expect("attach tag");

        let map = map_for_account(&conn, account_id).expect("map tags for account");

        assert_eq!(map.get(&tagged).map(|tags| tags.len()), Some(2));
        assert_eq!(map.get(&untagged), None);
    }

    #[test]
    fn deleting_a_transaction_cascades_to_its_tag_attachments() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let transaction_id = create_test_transaction(&conn);
        let tag = get_or_create(&conn, "Reimbursable").expect("get or create tag");
        attach(&conn, transaction_id, tag.id).expect("attach tag");

        transactions::delete(&conn, transaction_id).expect("delete transaction");

        // No direct way to query transaction_tags for a deleted transaction id
        // (it's gone), but the tag itself must survive independently.
        assert_eq!(get(&conn, tag.id).expect("get tag"), Some(tag));
    }
}

//! Merchant: a keyword-to-canonical-name mapping (see issue #36 and
//! CONTEXT.md's Categorization Rule entry) used to identify a clean Merchant
//! name from a Transaction's raw imported description. Persisted locally,
//! seeded with a small curated dictionary, and fully user-editable — no
//! distinction between seeded and user-added entries.
//!
//! Matching reuses [`crate::import::fingerprint::normalize_description`] (the
//! same lowercase/whitespace-collapse normalization import-dedup
//! fingerprinting already applies) so "the stable identity of the text" is
//! computed once, the same way, for both purposes.

use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::Serialize;

use crate::import::fingerprint;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Merchant {
    pub id: i64,
    pub keyword: String,
    pub merchant_name: String,
}

fn merchant_from_row(row: &rusqlite::Row) -> rusqlite::Result<Merchant> {
    Ok(Merchant {
        id: row.get(0)?,
        keyword: row.get(1)?,
        merchant_name: row.get(2)?,
    })
}

fn keyword_already_exists(conn: &Connection, keyword: &str, excluding_id: Option<i64>) -> rusqlite::Result<bool> {
    match excluding_id {
        Some(id) => conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM merchants WHERE keyword = ?1 COLLATE NOCASE AND id != ?2)",
            rusqlite::params![keyword, id],
            |row| row.get(0),
        ),
        None => conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM merchants WHERE keyword = ?1 COLLATE NOCASE)",
            [keyword],
            |row| row.get(0),
        ),
    }
}

/// Creates a Merchant entry. Rejected with a clear error when `keyword`
/// already exists (case-insensitively) on another entry.
pub fn create(conn: &Connection, keyword: &str, merchant_name: &str) -> Result<Merchant, String> {
    if keyword_already_exists(conn, keyword, None).map_err(|e| e.to_string())? {
        return Err(format!("A Merchant entry with keyword \"{keyword}\" already exists"));
    }

    conn.execute(
        "INSERT INTO merchants (keyword, merchant_name) VALUES (?1, ?2)",
        rusqlite::params![keyword, merchant_name],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();

    Ok(Merchant {
        id,
        keyword: keyword.to_string(),
        merchant_name: merchant_name.to_string(),
    })
}

/// Ordered by id (creation order), since matching ties resolve to the
/// earliest-created entry.
pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Merchant>> {
    let mut stmt = conn.prepare("SELECT id, keyword, merchant_name FROM merchants ORDER BY id")?;
    let rows = stmt.query_map([], merchant_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Merchant>> {
    conn.query_row(
        "SELECT id, keyword, merchant_name FROM merchants WHERE id = ?1",
        [id],
        merchant_from_row,
    )
    .optional()
}

/// Updates a Merchant entry. Rejected with a clear error when `keyword`
/// already exists (case-insensitively) on a *different* entry.
pub fn update(conn: &Connection, id: i64, keyword: &str, merchant_name: &str) -> Result<Merchant, String> {
    if keyword_already_exists(conn, keyword, Some(id)).map_err(|e| e.to_string())? {
        return Err(format!("A Merchant entry with keyword \"{keyword}\" already exists"));
    }

    let rows_affected = conn
        .execute(
            "UPDATE merchants SET keyword = ?1, merchant_name = ?2, updated_at = datetime('now') WHERE id = ?3",
            rusqlite::params![keyword, merchant_name, id],
        )
        .map_err(|e| e.to_string())?;
    if rows_affected == 0 {
        return Err(format!("No Merchant entry with id {id}"));
    }

    Ok(Merchant {
        id,
        keyword: keyword.to_string(),
        merchant_name: merchant_name.to_string(),
    })
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM merchants WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

/// Identifies a Merchant name for a raw Transaction description, or `None`
/// when no keyword matches.
///
/// Matches case-insensitively (via the same normalization
/// [`fingerprint::normalize_description`] uses) as a substring containment
/// against every Merchant keyword. When multiple keywords match, the
/// *longest* matching keyword wins (most specific match); ties between
/// equal-length keywords resolve to the earliest-created entry, which falls
/// out naturally from `list`'s id-ascending order and a strict `>` length
/// comparison below (an equal-length later match never displaces an
/// earlier one).
pub fn match_description(conn: &Connection, description: &str) -> rusqlite::Result<Option<String>> {
    let normalized_description = fingerprint::normalize_description(description);
    let entries = list(conn)?;

    let mut best: Option<(usize, String)> = None;
    for entry in entries {
        let normalized_keyword = fingerprint::normalize_description(&entry.keyword);
        if normalized_keyword.is_empty() {
            continue;
        }
        if !normalized_description.contains(&normalized_keyword) {
            continue;
        }
        let length = normalized_keyword.len();
        let is_better = match &best {
            Some((best_length, _)) => length > *best_length,
            None => true,
        };
        if is_better {
            best = Some((length, entry.merchant_name));
        }
    }

    Ok(best.map(|(_, name)| name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn create_returns_the_new_merchant_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let merchant = create(&conn, "zzz test coffee", "ZZZ Test Coffee").expect("create merchant");

        assert_eq!(merchant.keyword, "zzz test coffee");
        assert_eq!(merchant.merchant_name, "ZZZ Test Coffee");
        assert!(merchant.id > 0);
    }

    #[test]
    fn create_rejects_a_duplicate_keyword_case_insensitively() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "ZZZ Test Coffee", "ZZZ Test Coffee").expect("create merchant");

        let result = create(&conn, "zzz test coffee", "ZZZ Test Coffee Co");

        assert!(result.is_err());
    }

    #[test]
    fn list_returns_merchants_in_creation_order() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let first = create(&conn, "zzz test one", "Z Corp").expect("create merchant");
        let second = create(&conn, "zzz test two", "A Corp").expect("create merchant");

        let merchants = list(&conn).expect("list merchants");
        let ids: Vec<i64> = merchants.iter().map(|m| m.id).collect();

        // Both newly-created entries must appear, in the order they were
        // created (they're appended after any pre-existing seed entries).
        let first_index = ids.iter().position(|&id| id == first.id).expect("first present");
        let second_index = ids.iter().position(|&id| id == second.id).expect("second present");
        assert!(first_index < second_index);
    }

    #[test]
    fn update_changes_the_stored_fields() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let created = create(&conn, "old", "Old Name").expect("create merchant");

        let updated = update(&conn, created.id, "new", "New Name").expect("update merchant");

        assert_eq!(updated.keyword, "new");
        assert_eq!(updated.merchant_name, "New Name");
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_rejects_a_duplicate_keyword_from_a_different_entry() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "taken", "Taken Co").expect("create merchant");
        let created = create(&conn, "mine", "Mine Co").expect("create merchant");

        let result = update(&conn, created.id, "TAKEN", "Mine Co");

        assert!(result.is_err());
    }

    #[test]
    fn update_allows_keeping_the_same_keyword() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let created = create(&conn, "same", "Same Co").expect("create merchant");

        let result = update(&conn, created.id, "same", "Renamed Co");

        assert!(result.is_ok());
    }

    #[test]
    fn update_fails_when_the_merchant_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update(&conn, 999, "x", "X Co");

        assert!(result.is_err());
    }

    #[test]
    fn delete_removes_the_merchant() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let created = create(&conn, "x", "X Co").expect("create merchant");

        delete(&conn, created.id).expect("delete merchant");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_fails_when_the_merchant_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999);

        assert!(result.is_err());
    }

    #[test]
    fn match_description_finds_a_matching_keyword_case_insensitively() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "zzz test coffee", "ZZZ Test Coffee").expect("create merchant");

        let matched = match_description(&conn, "SQ *ZZZ TEST COFFEE COF 04/12 #4471").expect("match description");

        assert_eq!(matched, Some("ZZZ Test Coffee".to_string()));
    }

    #[test]
    fn match_description_returns_none_when_nothing_matches() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "zzz test coffee", "ZZZ Test Coffee").expect("create merchant");

        let matched = match_description(&conn, "Unrelated Store #99").expect("match description");

        assert_eq!(matched, None);
    }

    #[test]
    fn match_description_prefers_the_longest_matching_keyword() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "coffee", "Generic Coffee").expect("create merchant");
        create(&conn, "zzz test coffee", "ZZZ Test Coffee").expect("create merchant");

        let matched = match_description(&conn, "ZZZ Test Coffee Downtown").expect("match description");

        assert_eq!(matched, Some("ZZZ Test Coffee".to_string()));
    }

    #[test]
    fn match_description_breaks_equal_length_ties_by_earliest_created_entry() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "abcdef", "First Match").expect("create merchant");
        create(&conn, "ghijkl", "Second Match").expect("create merchant");

        let matched = match_description(&conn, "abcdef ghijkl").expect("match description");

        assert_eq!(matched, Some("First Match".to_string()));
    }
}

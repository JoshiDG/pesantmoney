use rusqlite::Connection;
#[cfg(test)]
use rusqlite::OptionalExtension;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CategoryGroup {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Category {
    pub id: i64,
    pub group_id: i64,
    pub name: String,
}

fn category_group_from_row(row: &rusqlite::Row) -> rusqlite::Result<CategoryGroup> {
    Ok(CategoryGroup {
        id: row.get(0)?,
        name: row.get(1)?,
    })
}

fn category_from_row(row: &rusqlite::Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: row.get(0)?,
        group_id: row.get(1)?,
        name: row.get(2)?,
    })
}

pub fn create_group(conn: &Connection, name: &str) -> rusqlite::Result<CategoryGroup> {
    conn.execute(
        "INSERT INTO category_groups (name) VALUES (?1)",
        rusqlite::params![name],
    )?;
    let id = conn.last_insert_rowid();

    Ok(CategoryGroup {
        id,
        name: name.to_string(),
    })
}

pub fn list_groups(conn: &Connection) -> rusqlite::Result<Vec<CategoryGroup>> {
    let mut stmt = conn.prepare("SELECT id, name FROM category_groups ORDER BY id")?;
    let rows = stmt.query_map([], category_group_from_row)?;
    rows.collect()
}

pub fn update_group(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<CategoryGroup> {
    let rows_affected = conn.execute(
        "UPDATE category_groups SET name = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![name, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(CategoryGroup {
        id,
        name: name.to_string(),
    })
}

pub fn delete_group(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM category_groups WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn create(conn: &Connection, group_id: i64, name: &str) -> rusqlite::Result<Category> {
    conn.execute(
        "INSERT INTO categories (group_id, name) VALUES (?1, ?2)",
        rusqlite::params![group_id, name],
    )?;
    let id = conn.last_insert_rowid();

    Ok(Category {
        id,
        group_id,
        name: name.to_string(),
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Category>> {
    let mut stmt = conn.prepare("SELECT id, group_id, name FROM categories ORDER BY id")?;
    let rows = stmt.query_map([], category_from_row)?;
    rows.collect()
}

#[cfg(test)]
pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Category>> {
    conn.query_row(
        "SELECT id, group_id, name FROM categories WHERE id = ?1",
        [id],
        category_from_row,
    )
    .optional()
}

pub fn update(
    conn: &Connection,
    id: i64,
    group_id: i64,
    name: &str,
) -> rusqlite::Result<Category> {
    let rows_affected = conn.execute(
        "UPDATE categories SET group_id = ?1, name = ?2, updated_at = datetime('now') WHERE id = ?3",
        rusqlite::params![group_id, name, id],
    )?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }

    Ok(Category {
        id,
        group_id,
        name: name.to_string(),
    })
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let rows_affected = conn.execute("DELETE FROM categories WHERE id = ?1", [id])?;
    if rows_affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn create_test_group(conn: &Connection) -> i64 {
        create_group(conn, "Food").expect("create category group").id
    }

    #[test]
    fn create_group_returns_the_new_group_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let group = create_group(&conn, "Housing").expect("create category group");

        assert_eq!(group.name, "Housing");
        assert!(group.id > 0);
    }

    #[test]
    fn list_groups_includes_seeded_defaults_plus_new_ones() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let seeded_count = list_groups(&conn).expect("list category groups").len();

        create_group(&conn, "Custom Group").expect("create category group");

        let groups = list_groups(&conn).expect("list category groups");
        assert_eq!(groups.len(), seeded_count + 1);
        assert!(groups.iter().any(|g| g.name == "Custom Group"));
    }

    #[test]
    fn update_group_changes_the_stored_name() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group = create_group(&conn, "Old Name").expect("create category group");

        let updated = update_group(&conn, group.id, "New Name").expect("update category group");

        assert_eq!(updated.name, "New Name");
    }

    #[test]
    fn update_group_fails_when_the_group_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = update_group(&conn, 999_999, "Nope");

        assert!(result.is_err());
    }

    #[test]
    fn delete_group_removes_it_and_cascades_to_its_categories() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = create_test_group(&conn);
        let category = create(&conn, group_id, "Snacks").expect("create category");

        delete_group(&conn, group_id).expect("delete category group");

        assert_eq!(get(&conn, category.id).unwrap(), None);
    }

    #[test]
    fn delete_group_fails_when_the_group_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete_group(&conn, 999_999);

        assert!(result.is_err());
    }

    #[test]
    fn create_returns_the_new_category_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = create_test_group(&conn);

        let category = create(&conn, group_id, "Groceries").expect("create category");

        assert_eq!(category.group_id, group_id);
        assert_eq!(category.name, "Groceries");
        assert!(category.id > 0);
    }

    #[test]
    fn list_includes_seeded_defaults_plus_new_ones() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = create_test_group(&conn);
        let seeded_count = list(&conn).expect("list categories").len();

        create(&conn, group_id, "Custom Category").expect("create category");

        let categories = list(&conn).expect("list categories");
        assert_eq!(categories.len(), seeded_count + 1);
    }

    #[test]
    fn get_returns_none_for_an_unknown_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let category = get(&conn, 999_999).expect("get category");

        assert_eq!(category, None);
    }

    #[test]
    fn update_changes_the_stored_fields_and_returns_the_updated_category() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = create_test_group(&conn);
        let other_group_id = create_group(&conn, "Other Group").expect("create group").id;
        let created = create(&conn, group_id, "Old name").expect("create category");

        let updated =
            update(&conn, created.id, other_group_id, "New name").expect("update category");

        assert_eq!(updated.group_id, other_group_id);
        assert_eq!(updated.name, "New name");
        assert_eq!(get(&conn, created.id).unwrap().unwrap(), updated);
    }

    #[test]
    fn update_fails_when_the_category_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = create_test_group(&conn);

        let result = update(&conn, 999_999, group_id, "Nope");

        assert!(result.is_err());
    }

    #[test]
    fn delete_removes_the_category_so_get_returns_none() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let group_id = create_test_group(&conn);
        let created = create(&conn, group_id, "Gone soon").expect("create category");

        delete(&conn, created.id).expect("delete category");

        assert_eq!(get(&conn, created.id).unwrap(), None);
    }

    #[test]
    fn delete_fails_when_the_category_does_not_exist() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let result = delete(&conn, 999_999);

        assert!(result.is_err());
    }
}

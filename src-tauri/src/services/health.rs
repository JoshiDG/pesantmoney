use rusqlite::Connection;

/// The schema's version: the count of migrations applied to `conn` so far.
/// A trivial round-trip through the real database, establishing the
/// service-layer test pattern: plain functions taking a `&Connection`,
/// tested directly with no mocking.
pub fn schema_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
        row.get(0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn schema_version_matches_applied_migration_count() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let version = schema_version(&conn).expect("query schema version");

        assert_eq!(version, db::applied_migration_count() as i64);
    }
}

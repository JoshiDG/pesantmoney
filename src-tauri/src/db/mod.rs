mod migrations;

use std::path::Path;

use rusqlite::Connection;

/// Opens (creating if absent) the SQLite database at `path` and brings it up
/// to the latest schema version.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    migrations::run(&conn)?;
    Ok(conn)
}

/// Opens an in-memory database migrated to the latest schema version, for
/// use as the real (unmocked) database in tests.
#[cfg(test)]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", true)?;
    migrations::run(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn applied_migration_count() -> usize {
    migrations::MIGRATIONS.len()
}

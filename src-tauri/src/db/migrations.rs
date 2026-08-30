use rusqlite::{params, Connection, Result};

/// Ordered, append-only list of migrations. Each entry is applied at most once,
/// tracked by version in the `schema_migrations` table. Never edit or reorder
/// an existing entry once it has shipped — add a new one instead.
pub const MIGRATIONS: &[(&str, &str)] = &[(
    "0001_initial",
    include_str!("../../migrations/0001_initial.sql"),
)];

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )?;

    for (version, sql) in MIGRATIONS {
        let already_applied: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            params![version],
            |row| row.get(0),
        )?;

        if already_applied {
            continue;
        }

        conn.execute_batch(sql)?;
        conn.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            params![version],
        )?;
    }

    Ok(())
}

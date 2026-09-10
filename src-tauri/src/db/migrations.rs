use rusqlite::{params, Connection, Result};

/// Ordered, append-only list of migrations. Each entry is applied at most once,
/// tracked by version in the `schema_migrations` table. Never edit or reorder
/// an existing entry once it has shipped — add a new one instead.
pub const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_initial", include_str!("../../migrations/0001_initial.sql")),
    ("0002_accounts", include_str!("../../migrations/0002_accounts.sql")),
    ("0003_transactions", include_str!("../../migrations/0003_transactions.sql")),
    ("0004_categories", include_str!("../../migrations/0004_categories.sql")),
    ("0005_imports", include_str!("../../migrations/0005_imports.sql")),
    ("0006_transfers", include_str!("../../migrations/0006_transfers.sql")),
    ("0007_budgets", include_str!("../../migrations/0007_budgets.sql")),
    ("0008_recurring_items", include_str!("../../migrations/0008_recurring_items.sql")),
    ("0009_holdings", include_str!("../../migrations/0009_holdings.sql")),
    ("0010_goals", include_str!("../../migrations/0010_goals.sql")),
    ("0011_categorization_rules", include_str!("../../migrations/0011_categorization_rules.sql")),
    ("0012_notification_log", include_str!("../../migrations/0012_notification_log.sql")),
    ("0013_merchants", include_str!("../../migrations/0013_merchants.sql")),
    (
        "0014_transaction_merchant_name",
        include_str!("../../migrations/0014_transaction_merchant_name.sql"),
    ),
    (
        "0015_transaction_hidden",
        include_str!("../../migrations/0015_transaction_hidden.sql"),
    ),
    (
        "0016_categorization_rule_actions",
        include_str!("../../migrations/0016_categorization_rule_actions.sql"),
    ),
    ("0017_tags", include_str!("../../migrations/0017_tags.sql")),
];

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

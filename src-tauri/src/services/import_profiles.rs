use rusqlite::Connection;
use serde::Serialize;

use crate::import::{ColumnMapping, SignConvention};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportProfile {
    pub id: i64,
    pub institution_name: String,
    pub date_column: i64,
    pub amount_column: i64,
    pub description_column: i64,
    pub sign_convention: SignConvention,
    pub has_header_row: bool,
}

impl ImportProfile {
    /// The saved column mapping in the shape `preview_import` expects.
    pub fn to_column_mapping(&self) -> ColumnMapping {
        ColumnMapping {
            date_column: self.date_column as usize,
            amount_column: self.amount_column as usize,
            description_column: self.description_column as usize,
            sign_convention: self.sign_convention,
            has_header_row: self.has_header_row,
        }
    }
}

fn sign_convention_as_str(sign_convention: SignConvention) -> &'static str {
    match sign_convention {
        SignConvention::NegativeIsDebit => "negative_is_debit",
        SignConvention::NegativeIsCredit => "negative_is_credit",
    }
}

fn sign_convention_from_str(s: &str) -> Option<SignConvention> {
    match s {
        "negative_is_debit" => Some(SignConvention::NegativeIsDebit),
        "negative_is_credit" => Some(SignConvention::NegativeIsCredit),
        _ => None,
    }
}

fn import_profile_from_row(row: &rusqlite::Row) -> rusqlite::Result<ImportProfile> {
    let sign_convention_str: String = row.get(5)?;
    let sign_convention = sign_convention_from_str(&sign_convention_str).ok_or_else(|| {
        rusqlite::Error::InvalidColumnType(5, "sign_convention".into(), rusqlite::types::Type::Text)
    })?;

    Ok(ImportProfile {
        id: row.get(0)?,
        institution_name: row.get(1)?,
        date_column: row.get(2)?,
        amount_column: row.get(3)?,
        description_column: row.get(4)?,
        sign_convention,
        has_header_row: row.get(6)?,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn create(
    conn: &Connection,
    institution_name: &str,
    date_column: i64,
    amount_column: i64,
    description_column: i64,
    sign_convention: SignConvention,
    has_header_row: bool,
) -> rusqlite::Result<ImportProfile> {
    conn.execute(
        "INSERT INTO import_profiles (institution_name, date_column, amount_column, description_column, sign_convention, has_header_row) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            institution_name,
            date_column,
            amount_column,
            description_column,
            sign_convention_as_str(sign_convention),
            has_header_row,
        ],
    )?;
    let id = conn.last_insert_rowid();

    Ok(ImportProfile {
        id,
        institution_name: institution_name.to_string(),
        date_column,
        amount_column,
        description_column,
        sign_convention,
        has_header_row,
    })
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<ImportProfile>> {
    let mut stmt = conn.prepare(
        "SELECT id, institution_name, date_column, amount_column, description_column, sign_convention, has_header_row \
         FROM import_profiles ORDER BY id",
    )?;
    let rows = stmt.query_map([], import_profile_from_row)?;
    rows.collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<ImportProfile>> {
    use rusqlite::OptionalExtension;
    conn.query_row(
        "SELECT id, institution_name, date_column, amount_column, description_column, sign_convention, has_header_row \
         FROM import_profiles WHERE id = ?1",
        [id],
        import_profile_from_row,
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn create_returns_the_new_profile_with_its_assigned_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let profile = create(&conn, "Ally Bank", 0, 1, 2, SignConvention::NegativeIsDebit, true)
            .expect("create import profile");

        assert_eq!(profile.institution_name, "Ally Bank");
        assert_eq!(profile.date_column, 0);
        assert_eq!(profile.sign_convention, SignConvention::NegativeIsDebit);
        assert!(profile.has_header_row);
        assert!(profile.id > 0);
    }

    #[test]
    fn list_returns_all_created_profiles() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        create(&conn, "Ally Bank", 0, 1, 2, SignConvention::NegativeIsDebit, true)
            .expect("create import profile");
        create(&conn, "Chase", 1, 2, 0, SignConvention::NegativeIsCredit, false)
            .expect("create import profile");

        let profiles = list(&conn).expect("list import profiles");

        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[1].institution_name, "Chase");
        assert_eq!(profiles[1].sign_convention, SignConvention::NegativeIsCredit);
        assert!(!profiles[1].has_header_row);
    }

    #[test]
    fn get_returns_none_for_an_unknown_id() {
        let conn = db::open_in_memory().expect("open in-memory test database");

        let profile = get(&conn, 999).expect("get import profile");

        assert_eq!(profile, None);
    }

    #[test]
    fn get_returns_the_matching_profile() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let created = create(&conn, "Ally Bank", 0, 1, 2, SignConvention::NegativeIsDebit, true)
            .expect("create import profile");

        let fetched = get(&conn, created.id).expect("get import profile");

        assert_eq!(fetched, Some(created));
    }

    #[test]
    fn to_column_mapping_carries_over_the_saved_columns() {
        let conn = db::open_in_memory().expect("open in-memory test database");
        let profile = create(&conn, "Ally Bank", 2, 0, 1, SignConvention::NegativeIsDebit, true)
            .expect("create import profile");

        let mapping = profile.to_column_mapping();

        assert_eq!(mapping.date_column, 2);
        assert_eq!(mapping.amount_column, 0);
        assert_eq!(mapping.description_column, 1);
    }
}

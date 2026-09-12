use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// User-facing app preferences, persisted as a single `settings.json` file in
/// the app data directory. A dedicated SQLite table would be overkill for the
/// handful of booleans this holds today.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    pub update_checks_enabled: bool,
    /// Native OS notification for a confirmed Recurring Item due soon. See
    /// `services::notifications`. Defaults on; `#[serde(default)]` so an
    /// older settings.json written before this field existed still loads.
    #[serde(default = "default_true")]
    pub bill_notifications_enabled: bool,
    /// Native OS notification for a Category going over its Assigned amount
    /// for the current Budget month. See `services::notifications`.
    #[serde(default = "default_true")]
    pub overspend_notifications_enabled: bool,
    /// Column Management (#68): which columns of the Transactions grid's
    /// Column Set are visible. One global config for the whole app, not
    /// per-view/per-Account. `#[serde(default)]` so a settings.json written
    /// before this field existed still loads (falling back to every column
    /// visible, matching the pre-#68 fixed 4-column grid plus the badges/
    /// chips it always showed).
    #[serde(default)]
    pub transaction_column_visibility: TransactionColumnVisibility,
    /// Column reorder (#94, ADR-0021 phase 5): the Transactions grid's
    /// Column Set in user-chosen left-to-right order, alongside
    /// `transaction_column_visibility` above. Stored as plain strings
    /// (column keys, e.g. "date", "payee") rather than a typed enum so an
    /// unrecognized/stale value here never fails deserialization -- the
    /// frontend's `resolveColumnOrder` is the single place that validates
    /// and falls back. `#[serde(default)]` defaults to an empty `Vec`,
    /// which both a pre-#94 settings.json and a freshly-created one share --
    /// the frontend treats empty the same as "no custom order", falling
    /// back to the Column Set's declaration order.
    #[serde(default)]
    pub transaction_column_order: Vec<String>,
}

fn default_true() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            update_checks_enabled: true,
            bill_notifications_enabled: true,
            overspend_notifications_enabled: true,
            transaction_column_visibility: TransactionColumnVisibility::default(),
            transaction_column_order: Vec::new(),
        }
    }
}

/// Column Management (#68) visibility flags for the Transactions grid's
/// Column Set (see CONTEXT.md's "Column Set" / "Column Management" entries).
/// The Account column is additionally force-hidden client-side whenever the
/// current view resolves to a single distinct Account, regardless of this
/// stored choice -- that suppression rule isn't persisted here since it's
/// derived per-view, not a user preference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TransactionColumnVisibility {
    #[serde(default = "default_true")]
    pub date: bool,
    #[serde(default = "default_true")]
    pub account: bool,
    #[serde(default = "default_true")]
    pub payee: bool,
    #[serde(default = "default_true")]
    pub memo: bool,
    #[serde(default = "default_true")]
    pub category: bool,
    #[serde(default = "default_true")]
    pub tags: bool,
    #[serde(default = "default_true")]
    pub amount: bool,
    #[serde(default = "default_true")]
    pub running_balance: bool,
}

impl Default for TransactionColumnVisibility {
    fn default() -> Self {
        TransactionColumnVisibility {
            date: true,
            account: true,
            payee: true,
            memo: true,
            category: true,
            tags: true,
            amount: true,
            running_balance: true,
        }
    }
}

fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

/// Reads settings from `<app_data_dir>/settings.json`. Falls back to
/// `Settings::default()` if the file is missing, unreadable, or contains
/// invalid JSON — a corrupt settings file should never stop the app from
/// starting.
pub fn load(app_data_dir: &Path) -> Settings {
    let path = settings_path(app_data_dir);
    match std::fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

/// Writes settings to `<app_data_dir>/settings.json`, creating the directory
/// if needed.
pub fn save(app_data_dir: &Path, settings: &Settings) -> std::io::Result<()> {
    std::fs::create_dir_all(app_data_dir)?;
    let path = settings_path(app_data_dir);
    let contents = serde_json::to_string_pretty(settings)?;
    std::fs::write(path, contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_returns_defaults_when_no_settings_file_exists() {
        let dir = tempfile::tempdir().expect("create tempdir");

        let settings = load(dir.path());

        assert_eq!(settings, Settings::default());
        assert!(settings.update_checks_enabled);
    }

    #[test]
    fn save_then_load_round_trips_the_written_value() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let settings = Settings {
            update_checks_enabled: false,
            bill_notifications_enabled: false,
            overspend_notifications_enabled: true,
            transaction_column_visibility: TransactionColumnVisibility::default(),
            transaction_column_order: Vec::new(),
        };

        save(dir.path(), &settings).expect("save settings");
        let loaded = load(dir.path());

        assert_eq!(loaded, settings);
    }

    #[test]
    fn load_falls_back_to_defaults_on_corrupt_json() {
        let dir = tempfile::tempdir().expect("create tempdir");
        std::fs::write(settings_path(dir.path()), "not valid json{{{").expect("write corrupt file");

        let settings = load(dir.path());

        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn load_defaults_notification_toggles_to_true_for_a_settings_file_predating_them() {
        let dir = tempfile::tempdir().expect("create tempdir");
        std::fs::write(settings_path(dir.path()), r#"{"update_checks_enabled":false}"#)
            .expect("write old-shape settings file");

        let settings = load(dir.path());

        assert!(!settings.update_checks_enabled);
        assert!(settings.bill_notifications_enabled);
        assert!(settings.overspend_notifications_enabled);
    }

    #[test]
    fn save_creates_the_app_data_directory_if_missing() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let nested = dir.path().join("nested").join("app-data");
        let settings = Settings {
            update_checks_enabled: false,
            bill_notifications_enabled: false,
            overspend_notifications_enabled: false,
            transaction_column_visibility: TransactionColumnVisibility::default(),
            transaction_column_order: Vec::new(),
        };

        save(&nested, &settings).expect("save settings into missing directory");
        let loaded = load(&nested);

        assert_eq!(loaded, settings);
    }

    #[test]
    fn transaction_column_visibility_defaults_to_every_column_visible() {
        let settings = Settings::default();

        assert_eq!(settings.transaction_column_visibility, TransactionColumnVisibility::default());
        assert!(settings.transaction_column_visibility.date);
        assert!(settings.transaction_column_visibility.account);
        assert!(settings.transaction_column_visibility.payee);
        assert!(settings.transaction_column_visibility.memo);
        assert!(settings.transaction_column_visibility.category);
        assert!(settings.transaction_column_visibility.tags);
        assert!(settings.transaction_column_visibility.amount);
        assert!(settings.transaction_column_visibility.running_balance);
    }

    #[test]
    fn save_then_load_round_trips_a_custom_column_visibility_choice() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let mut settings = Settings::default();
        settings.transaction_column_visibility.tags = false;
        settings.transaction_column_visibility.running_balance = false;

        save(dir.path(), &settings).expect("save settings");
        let loaded = load(dir.path());

        assert_eq!(loaded, settings);
        assert!(!loaded.transaction_column_visibility.tags);
        assert!(!loaded.transaction_column_visibility.running_balance);
        assert!(loaded.transaction_column_visibility.date);
    }

    #[test]
    fn load_defaults_column_visibility_to_all_visible_for_a_settings_file_predating_it() {
        let dir = tempfile::tempdir().expect("create tempdir");
        std::fs::write(settings_path(dir.path()), r#"{"update_checks_enabled":false}"#)
            .expect("write old-shape settings file");

        let settings = load(dir.path());

        assert_eq!(settings.transaction_column_visibility, TransactionColumnVisibility::default());
    }

    #[test]
    fn transaction_column_order_defaults_to_empty() {
        let settings = Settings::default();

        assert!(settings.transaction_column_order.is_empty());
    }

    #[test]
    fn save_then_load_round_trips_a_custom_column_order() {
        let dir = tempfile::tempdir().expect("create tempdir");
        let mut settings = Settings::default();
        settings.transaction_column_order =
            vec!["amount".to_string(), "date".to_string(), "payee".to_string()];

        save(dir.path(), &settings).expect("save settings");
        let loaded = load(dir.path());

        assert_eq!(loaded, settings);
        assert_eq!(
            loaded.transaction_column_order,
            vec!["amount".to_string(), "date".to_string(), "payee".to_string()]
        );
    }

    #[test]
    fn load_defaults_column_order_to_empty_for_a_settings_file_predating_it() {
        let dir = tempfile::tempdir().expect("create tempdir");
        std::fs::write(
            settings_path(dir.path()),
            r#"{"update_checks_enabled":false,"transaction_column_visibility":{"tags":false}}"#,
        )
        .expect("write old-shape settings file");

        let settings = load(dir.path());

        assert!(settings.transaction_column_order.is_empty());
        assert!(!settings.transaction_column_visibility.tags);
    }
}

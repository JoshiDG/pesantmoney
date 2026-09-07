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
        };

        save(&nested, &settings).expect("save settings into missing directory");
        let loaded = load(&nested);

        assert_eq!(loaded, settings);
    }
}

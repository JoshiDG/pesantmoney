use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::Local;
use serde::Serialize;

/// Outcome of the automatic startup backup, kept in `AppState` so the
/// Settings screen can show it — an automatic action still needs to surface
/// failure visibly rather than fail silently (disk full, permission denied,
/// etc.), even though no user is watching at the moment it runs.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "outcome")]
pub enum BackupStatus {
    Success { path: String, taken_at: String },
    Failed { message: String },
}

/// Runs [`snapshot_and_prune`] and converts the result into a [`BackupStatus`]
/// for storage in `AppState`, rather than panicking or silently swallowing
/// the error — a failed automatic backup should never crash app startup, but
/// it must still be visible to the user via Settings.
pub fn run_startup_backup(db_path: &Path, app_data_dir: &Path) -> BackupStatus {
    match snapshot_and_prune(db_path, app_data_dir) {
        Ok(path) => BackupStatus::Success {
            path: path.display().to_string(),
            taken_at: Local::now().to_rfc3339(),
        },
        Err(e) => BackupStatus::Failed {
            message: e.to_string(),
        },
    }
}

/// Number of rolling snapshots to retain in the backups folder. Chosen as a
/// balance between recovery flexibility (roughly a couple of weeks of daily
/// launches) and disk usage for a SQLite file that could grow to tens of MB.
pub const RETENTION_COUNT: usize = 10;

const SNAPSHOT_PREFIX: &str = "pesantmoney-";
const SNAPSHOT_EXTENSION: &str = "db";

/// The `backups` subfolder of the app data directory, where rolling
/// snapshots and manual exports both start from a copy of this file.
pub fn backups_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("backups")
}

fn snapshot_filename(timestamp: &str) -> String {
    format!("{SNAPSHOT_PREFIX}{timestamp}.{SNAPSHOT_EXTENSION}")
}

fn is_snapshot_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with(SNAPSHOT_PREFIX) && name.ends_with(&format!(".{SNAPSHOT_EXTENSION}")))
        .unwrap_or(false)
}

/// Copies `db_path` into `<app_data_dir>/backups/pesantmoney-<timestamp>.db`,
/// then prunes the backups folder down to the newest [`RETENTION_COUNT`]
/// snapshots. Intended to run once per app launch, with no user action
/// needed, so a rolling local safety net always exists even if the user
/// never thinks about backups.
///
/// This is a plain file copy, not a structured/encrypted export — consistent
/// with ADR-0006 (no app-level encryption) and ADR-0005 (single device, no
/// sync). The connection to `db_path` should be held (e.g. the app's
/// `Mutex<Connection>` lock) by the caller for the duration of this call so
/// no write lands mid-copy.
pub fn snapshot_and_prune(db_path: &Path, app_data_dir: &Path) -> io::Result<PathBuf> {
    let dir = backups_dir(app_data_dir);
    fs::create_dir_all(&dir)?;

    // Microsecond precision keeps filenames unique even across snapshots
    // taken in rapid succession (e.g. in tests), and sorts lexicographically
    // in the same order as chronologically, which `prune` relies on.
    let timestamp = Local::now().format("%Y%m%d-%H%M%S%.6f").to_string();
    let dest = dir.join(snapshot_filename(&timestamp));
    fs::copy(db_path, &dest)?;

    prune(&dir, RETENTION_COUNT)?;

    Ok(dest)
}

/// Removes the oldest snapshot files in `dir` beyond the newest `keep`,
/// ordered by filename. Non-snapshot files (nothing today, but leaves room
/// for e.g. a `.gitkeep`) are left untouched.
fn prune(dir: &Path, keep: usize) -> io::Result<()> {
    let mut snapshots: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| is_snapshot_file(path))
        .collect();

    snapshots.sort();

    if snapshots.len() > keep {
        for path in &snapshots[..snapshots.len() - keep] {
            fs::remove_file(path)?;
        }
    }

    Ok(())
}

/// Copies `db_path` to an arbitrary user-chosen `destination`, for the
/// manual "Export data" action. Unlike [`snapshot_and_prune`], this never
/// touches the backups folder or retention — it's a one-off portable copy
/// the user explicitly asked for and is fully responsible for.
pub fn export_to(db_path: &Path, destination: &Path) -> io::Result<()> {
    if let Some(parent) = destination.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    fs::copy(db_path, destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_fake_db(path: &Path, contents: &[u8]) {
        fs::write(path, contents).expect("write fake db file");
    }

    #[test]
    fn snapshot_and_prune_creates_a_snapshot_file_with_the_db_contents() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("pesantmoney.db");
        write_fake_db(&db_path, b"sqlite-contents");
        let app_data_dir = dir.path().join("app-data");
        fs::create_dir_all(&app_data_dir).expect("create app data dir");

        let snapshot_path = snapshot_and_prune(&db_path, &app_data_dir).expect("snapshot");

        assert!(snapshot_path.exists());
        assert_eq!(fs::read(&snapshot_path).unwrap(), b"sqlite-contents");
        assert_eq!(snapshot_path.parent().unwrap(), backups_dir(&app_data_dir));
    }

    #[test]
    fn snapshot_and_prune_creates_the_backups_directory_if_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("pesantmoney.db");
        write_fake_db(&db_path, b"data");
        let app_data_dir = dir.path().join("app-data");
        fs::create_dir_all(&app_data_dir).expect("create app data dir");

        assert!(!backups_dir(&app_data_dir).exists());

        snapshot_and_prune(&db_path, &app_data_dir).expect("snapshot");

        assert!(backups_dir(&app_data_dir).is_dir());
    }

    #[test]
    fn prune_keeps_only_the_newest_n_snapshots() {
        let dir = tempfile::tempdir().expect("tempdir");
        let backups = dir.path().join("backups");
        fs::create_dir_all(&backups).expect("create backups dir");

        // Lexicographically increasing names, as real timestamped snapshots
        // would have.
        let total = RETENTION_COUNT + 5;
        for i in 0..total {
            let name = format!("pesantmoney-{i:04}.db");
            fs::write(backups.join(name), b"x").expect("write fake snapshot");
        }

        prune(&backups, RETENTION_COUNT).expect("prune");

        let mut remaining: Vec<String> = fs::read_dir(&backups)
            .expect("read backups dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        remaining.sort();

        let expected: Vec<String> = (5..total).map(|i| format!("pesantmoney-{i:04}.db")).collect();
        assert_eq!(remaining, expected);
    }

    #[test]
    fn repeated_snapshots_across_launches_prune_down_to_the_retention_limit() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("pesantmoney.db");
        write_fake_db(&db_path, b"v0");
        let app_data_dir = dir.path().join("app-data");
        fs::create_dir_all(&app_data_dir).expect("create app data dir");

        for i in 0..(RETENTION_COUNT + 3) {
            write_fake_db(&db_path, format!("v{i}").as_bytes());
            snapshot_and_prune(&db_path, &app_data_dir).expect("snapshot");
        }

        let backups = backups_dir(&app_data_dir);
        let count = fs::read_dir(&backups).expect("read backups dir").count();
        assert_eq!(count, RETENTION_COUNT);
    }

    #[test]
    fn snapshot_and_prune_surfaces_an_error_when_the_source_db_is_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("does-not-exist.db");
        let app_data_dir = dir.path().join("app-data");
        fs::create_dir_all(&app_data_dir).expect("create app data dir");

        let result = snapshot_and_prune(&db_path, &app_data_dir);

        assert!(result.is_err());
    }

    #[test]
    fn export_to_copies_the_db_to_an_arbitrary_destination() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("pesantmoney.db");
        write_fake_db(&db_path, b"export-me");
        let destination = dir.path().join("exports").join("my-export.db");

        export_to(&db_path, &destination).expect("export");

        assert_eq!(fs::read(&destination).unwrap(), b"export-me");
    }

    #[test]
    fn export_to_surfaces_an_error_when_the_source_db_is_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("does-not-exist.db");
        let destination = dir.path().join("export.db");

        let result = export_to(&db_path, &destination);

        assert!(result.is_err());
    }

    #[test]
    fn run_startup_backup_reports_success_when_the_snapshot_is_created() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("pesantmoney.db");
        write_fake_db(&db_path, b"data");
        let app_data_dir = dir.path().join("app-data");
        fs::create_dir_all(&app_data_dir).expect("create app data dir");

        let status = run_startup_backup(&db_path, &app_data_dir);

        match status {
            BackupStatus::Success { path, .. } => assert!(Path::new(&path).exists()),
            BackupStatus::Failed { message } => panic!("expected success, got failure: {message}"),
        }
    }

    #[test]
    fn run_startup_backup_reports_failure_when_the_source_db_is_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("does-not-exist.db");
        let app_data_dir = dir.path().join("app-data");
        fs::create_dir_all(&app_data_dir).expect("create app data dir");

        let status = run_startup_backup(&db_path, &app_data_dir);

        match status {
            BackupStatus::Failed { message } => assert!(!message.is_empty()),
            BackupStatus::Success { .. } => panic!("expected failure for a missing source db"),
        }
    }
}

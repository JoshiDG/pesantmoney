use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::Local;
use serde::{Deserialize, Serialize};

pub const MAX_FOLDER_BACKUPS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FolderSyncConfig {
    pub sync_folder_path: Option<String>,
    pub auto_sync: bool,
    pub last_synced_at: Option<String>,
    pub last_sync_status: Option<String>,
    pub last_sync_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderSyncStatus {
    pub configured: bool,
    pub sync_folder_path: Option<String>,
    pub auto_sync: bool,
    pub last_synced_at: Option<String>,
    pub last_sync_status: Option<String>,
    pub last_sync_error: Option<String>,
    pub backup_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderBackupFile {
    pub path: String,
    pub name: String,
    pub modified_at: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "outcome")]
pub enum FolderSyncResult {
    Success {
        dest_path: String,
        synced_at: String,
        backup_count: usize,
    },
    Failed {
        message: String,
    },
}

fn config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("folder_sync_config.json")
}

pub fn load_config(app_data_dir: &Path) -> FolderSyncConfig {
    let path = config_path(app_data_dir);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => FolderSyncConfig::default(),
    }
}

pub fn save_config(app_data_dir: &Path, config: &FolderSyncConfig) -> io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    let path = config_path(app_data_dir);
    let contents = serde_json::to_string_pretty(config)?;
    fs::write(path, contents)
}

pub fn get_status(app_data_dir: &Path) -> FolderSyncStatus {
    let config = load_config(app_data_dir);
    let configured = config.sync_folder_path.is_some();
    let backup_count = if configured {
        list_backups(app_data_dir).map(|files| files.len()).unwrap_or(0)
    } else {
        0
    };

    FolderSyncStatus {
        configured,
        sync_folder_path: config.sync_folder_path,
        auto_sync: config.auto_sync,
        last_synced_at: config.last_synced_at,
        last_sync_status: config.last_sync_status,
        last_sync_error: config.last_sync_error,
        backup_count,
    }
}

pub fn set_sync_folder(app_data_dir: &Path, folder_path: Option<String>) -> io::Result<FolderSyncConfig> {
    let mut config = load_config(app_data_dir);
    config.sync_folder_path = folder_path;
    save_config(app_data_dir, &config)?;
    Ok(config)
}

pub fn update_auto_sync(app_data_dir: &Path, enabled: bool) -> io::Result<FolderSyncConfig> {
    let mut config = load_config(app_data_dir);
    config.auto_sync = enabled;
    save_config(app_data_dir, &config)?;
    Ok(config)
}

pub fn sync_now(db_path: &Path, app_data_dir: &Path) -> FolderSyncResult {
    let mut config = load_config(app_data_dir);
    let folder_str = match config.sync_folder_path {
        Some(ref f) if !f.trim().is_empty() => f.clone(),
        _ => return FolderSyncResult::Failed { message: "No sync folder configured (e.g. Dropbox or Google Drive folder)".to_string() },
    };

    let target_dir = Path::new(&folder_str);
    if let Err(e) = fs::create_dir_all(target_dir) {
        let msg = format!("Failed to access or create sync folder '{folder_str}': {e}");
        config.last_sync_status = Some("failed".to_string());
        config.last_sync_error = Some(msg.clone());
        let _ = save_config(app_data_dir, &config);
        return FolderSyncResult::Failed { message: msg };
    }

    // 1. Copy main pesantmoney.db for direct file sync
    let main_dest = target_dir.join("pesantmoney.db");
    if let Err(e) = fs::copy(db_path, &main_dest) {
        let msg = format!("Failed to copy database to sync folder: {e}");
        config.last_sync_status = Some("failed".to_string());
        config.last_sync_error = Some(msg.clone());
        let _ = save_config(app_data_dir, &config);
        return FolderSyncResult::Failed { message: msg };
    }

    // 2. Also keep a rolling timestamped snapshot inside <target_dir>/backups/
    let backups_dir = target_dir.join("backups");
    let _ = fs::create_dir_all(&backups_dir);

    let timestamp = Local::now().format("%Y%m%d-%H%M%S%.6f").to_string();
    let snapshot_name = format!("pesantmoney-{timestamp}.db");
    let snapshot_dest = backups_dir.join(&snapshot_name);
    let _ = fs::copy(db_path, &snapshot_dest);

    // Prune old snapshots in sync folder
    let _ = prune_backups(&backups_dir, MAX_FOLDER_BACKUPS);

    let synced_at = Local::now().to_rfc3339();
    config.last_synced_at = Some(synced_at.clone());
    config.last_sync_status = Some("success".to_string());
    config.last_sync_error = None;
    let _ = save_config(app_data_dir, &config);

    let count = list_backups(app_data_dir).map(|b| b.len()).unwrap_or(1);

    FolderSyncResult::Success {
        dest_path: main_dest.display().to_string(),
        synced_at,
        backup_count: count,
    }
}

pub fn list_backups(app_data_dir: &Path) -> Result<Vec<FolderBackupFile>, String> {
    let config = load_config(app_data_dir);
    let folder_str = config
        .sync_folder_path
        .ok_or_else(|| "No sync folder configured".to_string())?;

    let backups_dir = Path::new(&folder_str).join("backups");
    if !backups_dir.exists() {
        return Ok(vec![]);
    }

    let mut result = Vec::new();
    let entries = fs::read_dir(&backups_dir).map_err(|e| format!("Failed to read backups directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("db") {
            let metadata = path.metadata().ok();
            let size_bytes = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = metadata
                .and_then(|m| m.modified().ok())
                .map(|t| {
                    let datetime: chrono::DateTime<Local> = t.into();
                    datetime.to_rfc3339()
                })
                .unwrap_or_default();

            result.push(FolderBackupFile {
                path: path.display().to_string(),
                name: entry.file_name().to_string_lossy().to_string(),
                modified_at,
                size_bytes,
            });
        }
    }

    result.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(result)
}

fn prune_backups(dir: &Path, keep: usize) -> io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }

    let mut files: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|ext| ext.to_str()) == Some("db"))
        .collect();

    files.sort();

    if files.len() > keep {
        for path in &files[..files.len() - keep] {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

pub fn restore_backup(db_path: &Path, app_data_dir: &Path, source_file_path: &str) -> Result<(), String> {
    let source = Path::new(source_file_path);
    if !source.exists() {
        return Err(format!("Backup file does not exist: {source_file_path}"));
    }

    // Safety snapshot before overwriting
    let safety_path = app_data_dir.join("pesantmoney-pre-restore-safety.db");
    let _ = fs::copy(db_path, &safety_path);

    fs::copy(source, db_path).map_err(|e| format!("Failed to restore database from {source_file_path}: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_and_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config = load_config(dir.path());
        assert!(config.sync_folder_path.is_none());
        assert!(!config.auto_sync);

        set_sync_folder(dir.path(), Some("/path/to/dropbox".to_string())).unwrap();
        let loaded = load_config(dir.path());
        assert_eq!(loaded.sync_folder_path, Some("/path/to/dropbox".to_string()));
    }

    #[test]
    fn sync_now_copies_db_and_creates_backup() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("pesantmoney.db");
        fs::write(&db_path, b"test-sqlite-bytes").unwrap();

        let sync_dir = dir.path().join("Dropbox").join("PesantMoney");
        set_sync_folder(dir.path(), Some(sync_dir.display().to_string())).unwrap();

        let res = sync_now(&db_path, dir.path());
        match res {
            FolderSyncResult::Success { dest_path, .. } => {
                assert!(Path::new(&dest_path).exists());
                assert_eq!(fs::read(&dest_path).unwrap(), b"test-sqlite-bytes");
            }
            FolderSyncResult::Failed { message } => panic!("sync failed: {message}"),
        }
    }
}

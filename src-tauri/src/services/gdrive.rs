use std::fs;
use std::io::{self, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Local;
use serde::{Deserialize, Serialize};

// Default Google OAuth Client credentials for desktop app (can be overridden in settings)
pub const DEFAULT_CLIENT_ID: &str = "1092837465012-pesantmoney.apps.googleusercontent.com";
pub const DEFAULT_CLIENT_SECRET: &str = "GOCSPX-PesantMoneyDesktopSecret";

pub const GDRIVE_FOLDER_NAME: &str = "PesantMoney Backups";
pub const MAX_REMOTE_BACKUPS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDriveConfig {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: Option<String>,
    pub access_token: Option<String>,
    pub token_expires_at: Option<u64>,
    pub user_email: Option<String>,
    pub auto_sync: bool,
    pub folder_id: Option<String>,
    pub last_synced_at: Option<String>,
    pub last_sync_status: Option<String>,
    pub last_sync_error: Option<String>,
}

impl Default for GDriveConfig {
    fn default() -> Self {
        Self {
            client_id: DEFAULT_CLIENT_ID.to_string(),
            client_secret: DEFAULT_CLIENT_SECRET.to_string(),
            refresh_token: None,
            access_token: None,
            token_expires_at: None,
            user_email: None,
            auto_sync: false,
            folder_id: None,
            last_synced_at: None,
            last_sync_status: None,
            last_sync_error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDriveStatus {
    pub connected: bool,
    pub user_email: Option<String>,
    pub auto_sync: bool,
    pub last_synced_at: Option<String>,
    pub last_sync_status: Option<String>,
    pub last_sync_error: Option<String>,
    pub backup_count: usize,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GDriveBackupFile {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub created_time: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "outcome")]
pub enum GDriveSyncResult {
    Success {
        file_id: String,
        file_name: String,
        synced_at: String,
        backup_count: usize,
    },
    Failed {
        message: String,
    },
}

fn config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("gdrive_config.json")
}

pub fn load_config(app_data_dir: &Path) -> GDriveConfig {
    let path = config_path(app_data_dir);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => GDriveConfig::default(),
    }
}

pub fn save_config(app_data_dir: &Path, config: &GDriveConfig) -> io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    let path = config_path(app_data_dir);
    let contents = serde_json::to_string_pretty(config)?;
    fs::write(path, contents)
}

pub fn get_status(app_data_dir: &Path) -> GDriveStatus {
    let config = load_config(app_data_dir);
    let connected = config.refresh_token.is_some() || config.access_token.is_some();

    // Count remote backups if connected
    let backup_count = if connected {
        list_remote_backups(app_data_dir).map(|files| files.len()).unwrap_or(0)
    } else {
        0
    };

    GDriveStatus {
        connected,
        user_email: config.user_email,
        auto_sync: config.auto_sync,
        last_synced_at: config.last_synced_at,
        last_sync_status: config.last_sync_status,
        last_sync_error: config.last_sync_error,
        backup_count,
        client_id: config.client_id,
    }
}

fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn get_valid_access_token(app_data_dir: &Path) -> Result<(String, GDriveConfig), String> {
    let mut config = load_config(app_data_dir);
    let now = current_timestamp_secs();

    // Check if existing access token is valid (with 60s buffer)
    if let (Some(ref token), Some(expires_at)) = (&config.access_token, config.token_expires_at) {
        if expires_at > now + 60 {
            return Ok((token.clone(), config));
        }
    }

    // Refresh token if present
    let refresh_token = config
        .refresh_token
        .clone()
        .ok_or_else(|| "Google Drive is not connected (no refresh token)".to_string())?;

    let client = reqwest::blocking::Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("client_secret", config.client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .map_err(|e| format!("Failed to refresh Google Drive token: {e}"))?;

    if !res.status().is_success() {
        let err_text = res.text().unwrap_or_default();
        return Err(format!("Token refresh failed: {err_text}"));
    }

    #[derive(Deserialize)]
    struct TokenResponse {
        access_token: String,
        expires_in: u64,
    }

    let token_data: TokenResponse = res
        .json()
        .map_err(|e| format!("Failed to parse token refresh response: {e}"))?;

    config.access_token = Some(token_data.access_token.clone());
    config.token_expires_at = Some(now + token_data.expires_in);

    save_config(app_data_dir, &config).map_err(|e| format!("Failed to save gdrive config: {e}"))?;

    Ok((token_data.access_token, config))
}

pub fn generate_auth_url(client_id: &str, redirect_uri: &str) -> String {
    let scope = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?\
client_id={}&\
redirect_uri={}&\
response_type=code&\
scope={}&\
access_type=offline&\
prompt=consent",
        urlencoding_encode(client_id),
        urlencoding_encode(redirect_uri),
        urlencoding_encode(scope),
    )
}

fn urlencoding_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u8),
        })
        .collect()
}

pub fn exchange_auth_code(
    app_data_dir: &Path,
    code: &str,
    redirect_uri: &str,
    client_id_override: Option<&str>,
    client_secret_override: Option<&str>,
) -> Result<GDriveConfig, String> {
    let mut config = load_config(app_data_dir);
    if let Some(cid) = client_id_override {
        config.client_id = cid.to_string();
    }
    if let Some(cs) = client_secret_override {
        config.client_secret = cs.to_string();
    }

    let client = reqwest::blocking::Client::new();
    let res = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", config.client_id.as_str()),
            ("client_secret", config.client_secret.as_str()),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .map_err(|e| format!("Failed to exchange authorization code: {e}"))?;

    if !res.status().is_success() {
        let err_text = res.text().unwrap_or_default();
        return Err(format!("Authorization code exchange failed: {err_text}"));
    }

    #[derive(Deserialize)]
    struct AuthResponse {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: u64,
    }

    let auth_data: AuthResponse = res
        .json()
        .map_err(|e| format!("Failed to parse auth token response: {e}"))?;

    let now = current_timestamp_secs();
    config.access_token = Some(auth_data.access_token.clone());
    if auth_data.refresh_token.is_some() {
        config.refresh_token = auth_data.refresh_token;
    }
    config.token_expires_at = Some(now + auth_data.expires_in);

    // Fetch user email
    if let Ok(user_info_res) = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(&auth_data.access_token)
        .send()
    {
        #[derive(Deserialize)]
        struct UserInfo {
            email: Option<String>,
        }
        if let Ok(user_info) = user_info_res.json::<UserInfo>() {
            config.user_email = user_info.email;
        }
    }

    config.last_sync_error = None;

    save_config(app_data_dir, &config).map_err(|e| format!("Failed to save gdrive config: {e}"))?;

    Ok(config)
}

pub fn disconnect(app_data_dir: &Path) -> io::Result<()> {
    let mut config = load_config(app_data_dir);
    config.access_token = None;
    config.refresh_token = None;
    config.token_expires_at = None;
    config.user_email = None;
    config.last_synced_at = None;
    config.last_sync_status = None;
    config.last_sync_error = None;
    save_config(app_data_dir, &config)
}

pub fn update_auto_sync(app_data_dir: &Path, enabled: bool) -> io::Result<GDriveConfig> {
    let mut config = load_config(app_data_dir);
    config.auto_sync = enabled;
    save_config(app_data_dir, &config)?;
    Ok(config)
}

pub fn update_credentials(
    app_data_dir: &Path,
    client_id: String,
    client_secret: String,
) -> io::Result<GDriveConfig> {
    let mut config = load_config(app_data_dir);
    config.client_id = client_id;
    config.client_secret = client_secret;
    save_config(app_data_dir, &config)?;
    Ok(config)
}

fn get_or_create_remote_folder(
    client: &reqwest::blocking::Client,
    access_token: &str,
    folder_name: &str,
) -> Result<String, String> {
    let search_url = format!(
        "https://www.googleapis.com/drive/v3/files?q=name='{}'+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false",
        urlencoding_encode(folder_name)
    );
    let res = client
        .get(&search_url)
        .bearer_auth(access_token)
        .send()
        .map_err(|e| format!("Folder search request failed: {e}"))?;

    if res.status().is_success() {
        #[derive(Deserialize)]
        struct FileItem {
            id: String,
        }
        #[derive(Deserialize)]
        struct SearchResponse {
            files: Vec<FileItem>,
        }
        if let Ok(data) = res.json::<SearchResponse>() {
            if let Some(first) = data.files.into_iter().next() {
                return Ok(first.id);
            }
        }
    }

    let body = serde_json::json!({
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder"
    });

    let create_res = client
        .post("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .map_err(|e| format!("Folder creation request failed: {e}"))?;

    if !create_res.status().is_success() {
        let err_text = create_res.text().unwrap_or_default();
        return Err(format!("Failed to create remote backup folder: {err_text}"));
    }

    #[derive(Deserialize)]
    struct CreateResponse {
        id: String,
    }

    let created: CreateResponse = create_res
        .json()
        .map_err(|e| format!("Failed to parse created folder response: {e}"))?;

    Ok(created.id)
}

pub fn list_remote_backups(app_data_dir: &Path) -> Result<Vec<GDriveBackupFile>, String> {
    let (access_token, _config) = get_valid_access_token(app_data_dir)?;
    let client = reqwest::blocking::Client::new();
    let folder_id = get_or_create_remote_folder(&client, &access_token, GDRIVE_FOLDER_NAME)?;

    let query = format!("'{}'+in+parents+and+trashed=false", folder_id);
    let url = format!(
        "https://www.googleapis.com/drive/v3/files?q={}&fields=files(id,name,mimeType,createdTime,size)&orderBy=createdTime+desc",
        query
    );

    let res = client
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .map_err(|e| format!("Failed to list remote backups: {e}"))?;

    if !res.status().is_success() {
        let err_text = res.text().unwrap_or_default();
        return Err(format!("Failed to query remote backups: {err_text}"));
    }

    #[derive(Deserialize)]
    struct ApiFile {
        id: String,
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "createdTime")]
        created_time: Option<String>,
        size: Option<String>,
    }

    #[derive(Deserialize)]
    struct ListResponse {
        files: Vec<ApiFile>,
    }

    let list_data: ListResponse = res
        .json()
        .map_err(|e| format!("Failed to parse remote backups list: {e}"))?;

    let files = list_data
        .files
        .into_iter()
        .map(|f| GDriveBackupFile {
            id: f.id,
            name: f.name,
            mime_type: f.mime_type,
            created_time: f.created_time.unwrap_or_default(),
            size_bytes: f.size.and_then(|s| s.parse::<u64>().ok()).unwrap_or(0),
        })
        .collect();

    Ok(files)
}

pub fn prune_remote_backups(
    client: &reqwest::blocking::Client,
    access_token: &str,
    backups: &[GDriveBackupFile],
    keep: usize,
) -> Result<(), String> {
    if backups.len() <= keep {
        return Ok(());
    }

    for file_to_delete in &backups[keep..] {
        let url = format!("https://www.googleapis.com/drive/v3/files/{}", file_to_delete.id);
        let _ = client
            .delete(&url)
            .bearer_auth(access_token)
            .send();
    }

    Ok(())
}

pub fn sync_now(db_path: &Path, app_data_dir: &Path) -> GDriveSyncResult {
    let (access_token, mut config) = match get_valid_access_token(app_data_dir) {
        Ok(res) => res,
        Err(e) => return GDriveSyncResult::Failed { message: e },
    };

    let db_bytes = match fs::read(db_path) {
        Ok(bytes) => bytes,
        Err(e) => {
            let msg = format!("Failed to read database file for backup: {e}");
            config.last_sync_status = Some("failed".to_string());
            config.last_sync_error = Some(msg.clone());
            let _ = save_config(app_data_dir, &config);
            return GDriveSyncResult::Failed { message: msg };
        }
    };

    let client = reqwest::blocking::Client::new();
    let folder_id = match get_or_create_remote_folder(&client, &access_token, GDRIVE_FOLDER_NAME) {
        Ok(id) => id,
        Err(e) => {
            config.last_sync_status = Some("failed".to_string());
            config.last_sync_error = Some(e.clone());
            let _ = save_config(app_data_dir, &config);
            return GDriveSyncResult::Failed { message: e };
        }
    };

    let timestamp = Local::now().format("%Y%m%d-%H%M%S%.6f").to_string();
    let snapshot_filename = format!("pesantmoney-{timestamp}.db");

    let metadata = serde_json::json!({
        "name": snapshot_filename,
        "parents": [folder_id]
    });

    let form = reqwest::blocking::multipart::Form::new()
        .text("metadata", metadata.to_string())
        .part(
            "file",
            reqwest::blocking::multipart::Part::bytes(db_bytes)
                .mime_str("application/octet-stream")
                .unwrap_or_else(|_| reqwest::blocking::multipart::Part::bytes(vec![])),
        );

    let res = client
        .post("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")
        .bearer_auth(&access_token)
        .multipart(form)
        .send();

    let res = match res {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Failed to upload DB to Google Drive: {e}");
            config.last_sync_status = Some("failed".to_string());
            config.last_sync_error = Some(msg.clone());
            let _ = save_config(app_data_dir, &config);
            return GDriveSyncResult::Failed { message: msg };
        }
    };

    if !res.status().is_success() {
        let err_text = res.text().unwrap_or_default();
        let msg = format!("Google Drive upload rejected: {err_text}");
        config.last_sync_status = Some("failed".to_string());
        config.last_sync_error = Some(msg.clone());
        let _ = save_config(app_data_dir, &config);
        return GDriveSyncResult::Failed { message: msg };
    }

    #[derive(Deserialize)]
    struct UploadResponse {
        id: String,
        name: Option<String>,
    }

    let upload_info: UploadResponse = match res.json() {
        Ok(info) => info,
        Err(e) => {
            let msg = format!("Failed to parse upload response: {e}");
            config.last_sync_status = Some("failed".to_string());
            config.last_sync_error = Some(msg.clone());
            let _ = save_config(app_data_dir, &config);
            return GDriveSyncResult::Failed { message: msg };
        }
    };

    let synced_at = Local::now().to_rfc3339();
    config.folder_id = Some(folder_id);
    config.last_synced_at = Some(synced_at.clone());
    config.last_sync_status = Some("success".to_string());
    config.last_sync_error = None;
    let _ = save_config(app_data_dir, &config);

    let remote_files = list_remote_backups(app_data_dir).unwrap_or_default();
    let _ = prune_remote_backups(&client, &access_token, &remote_files, MAX_REMOTE_BACKUPS);

    GDriveSyncResult::Success {
        file_id: upload_info.id,
        file_name: upload_info.name.unwrap_or(snapshot_filename),
        synced_at,
        backup_count: remote_files.len().min(MAX_REMOTE_BACKUPS),
    }
}

pub fn restore_remote_backup(
    db_path: &Path,
    app_data_dir: &Path,
    file_id: &str,
) -> Result<(), String> {
    let (access_token, _config) = get_valid_access_token(app_data_dir)?;
    let client = reqwest::blocking::Client::new();
    let url = format!("https://www.googleapis.com/drive/v3/files/{}?alt=media", file_id);

    let res = client
        .get(&url)
        .bearer_auth(&access_token)
        .send()
        .map_err(|e| format!("Download backup request failed: {e}"))?;

    if !res.status().is_success() {
        let err_text = res.text().unwrap_or_default();
        return Err(format!("Download failed: {err_text}"));
    }

    let bytes = res
        .bytes()
        .map_err(|e| format!("Failed to read backup content bytes: {e}"))?;

    let safety_path = app_data_dir.join("pesantmoney-pre-restore-safety.db");
    let _ = fs::copy(db_path, &safety_path);

    fs::write(db_path, bytes).map_err(|e| format!("Failed to overwrite database with restored backup: {e}"))?;

    Ok(())
}

pub fn start_oauth_listener(app_data_dir: PathBuf) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:8989")
        .map_err(|e| format!("Failed to bind local OAuth listener on port 8989: {e}"))?;

    let redirect_uri = "http://127.0.0.1:8989/oauth/callback";
    let config = load_config(&app_data_dir);
    let auth_url = generate_auth_url(&config.client_id, redirect_uri);

    let app_data_dir_clone = app_data_dir;
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 2048];
            if let Ok(n) = stream.read(&mut buf) {
                let req = String::from_utf8_lossy(&buf[..n]);
                if let Some(code_start) = req.find("code=") {
                    let code_str = &req[code_start + 5..];
                    let code = code_str
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .split('&')
                        .next()
                        .unwrap_or("");

                    if !code.is_empty() {
                        let _ = exchange_auth_code(&app_data_dir_clone, code, redirect_uri, None, None);
                        let response_html = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n\
<html><head><title>PesantMoney - Google Drive Connected</title></head>\
<body style='font-family: sans-serif; text-align: center; padding: 50px;'>\
<h1 style='color: #10b981;'>Google Drive Connected Successfully!</h1>\
<p>You can now close this tab and return to PesantMoney.</p>\
</body></html>";
                        let _ = stream.write_all(response_html.as_bytes());
                    }
                }
            }
        }
    });

    Ok(auth_url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_and_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = load_config(dir.path());
        assert_eq!(config.client_id, DEFAULT_CLIENT_ID);
        assert!(!config.auto_sync);
        assert!(config.refresh_token.is_none());

        config.user_email = Some("test@example.com".to_string());
        config.refresh_token = Some("refresh_123".to_string());
        save_config(dir.path(), &config).unwrap();

        let loaded = load_config(dir.path());
        assert_eq!(loaded.user_email, Some("test@example.com".to_string()));
        assert_eq!(loaded.refresh_token, Some("refresh_123".to_string()));
    }

    #[test]
    fn get_status_returns_disconnected_initially() {
        let dir = tempfile::tempdir().expect("tempdir");
        let status = get_status(dir.path());
        assert!(!status.connected);
        assert!(status.user_email.is_none());
        assert_eq!(status.backup_count, 0);
    }

    #[test]
    fn auth_url_generation_formats_correctly() {
        let url = generate_auth_url("my-client-id", "http://127.0.0.1:8989/oauth/callback");
        assert!(url.contains("client_id=my-client-id"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A8989%2Foauth%2Fcallback"));
        assert!(url.contains("scope="));
    }

    #[test]
    fn disconnect_clears_tokens_and_user_info() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut config = load_config(dir.path());
        config.refresh_token = Some("token".to_string());
        config.user_email = Some("user@test.com".to_string());
        save_config(dir.path(), &config).unwrap();

        disconnect(dir.path()).unwrap();
        let status = get_status(dir.path());
        assert!(!status.connected);
        assert!(status.user_email.is_none());
    }

    #[test]
    fn update_auto_sync_persists_flag() {
        let dir = tempfile::tempdir().expect("tempdir");
        update_auto_sync(dir.path(), true).unwrap();
        let status = get_status(dir.path());
        assert!(status.auto_sync);
    }
}

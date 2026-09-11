export interface Settings {
  update_checks_enabled: boolean;
  bill_notifications_enabled: boolean;
  overspend_notifications_enabled: boolean;
}

export interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version: string | null;
}

export type BackupStatus =
  | { outcome: "success"; path: string; taken_at: string }
  | { outcome: "failed"; message: string };

export interface GDriveStatus {
  connected: boolean;
  user_email: string | null;
  auto_sync: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  backup_count: number;
  client_id: string;
}

export interface GDriveBackupFile {
  id: string;
  name: string;
  mime_type: string;
  created_time: string;
  size_bytes: number;
}

export type GDriveSyncResult =
  | { outcome: "success"; file_id: string; file_name: string; synced_at: string; backup_count: number }
  | { outcome: "failed"; message: string };

export interface FolderSyncStatus {
  configured: boolean;
  sync_folder_path: string | null;
  auto_sync: boolean;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  backup_count: number;
}

export interface FolderBackupFile {
  path: string;
  name: string;
  modified_at: string;
  size_bytes: number;
}

export type FolderSyncResult =
  | { outcome: "success"; dest_path: string; synced_at: string; backup_count: number }
  | { outcome: "failed"; message: string };



export interface Settings {
  update_checks_enabled: boolean;
}

export interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version: string | null;
}

export type BackupStatus =
  | { outcome: "success"; path: string; taken_at: string }
  | { outcome: "failed"; message: string };

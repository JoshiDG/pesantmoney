export interface Settings {
  update_checks_enabled: boolean;
}

export interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version: string | null;
}

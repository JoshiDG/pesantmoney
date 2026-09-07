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

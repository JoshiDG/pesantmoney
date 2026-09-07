import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { BackupStatus, Settings, UpdateCheckResult } from "./types";

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);
  const [backupStatusError, setBackupStatusError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  async function refresh() {
    try {
      setSettings(await invoke<Settings>("get_settings"));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function refreshBackupStatus() {
    try {
      setBackupStatus(await invoke<BackupStatus>("get_backup_status"));
      setBackupStatusError(null);
    } catch (err) {
      setBackupStatusError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    refreshBackupStatus();
  }, []);

  async function saveSettings(next: Settings) {
    try {
      setSettings(await invoke<Settings>("update_settings", { ...next }));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleToggleUpdateChecks(enabled: boolean) {
    if (!settings) return;
    await saveSettings({ ...settings, update_checks_enabled: enabled });
    if (!enabled) {
      setCheckResult(null);
      setCheckError(null);
    }
  }

  async function handleToggleBillNotifications(enabled: boolean) {
    if (!settings) return;
    await saveSettings({ ...settings, bill_notifications_enabled: enabled });
  }

  async function handleToggleOverspendNotifications(enabled: boolean) {
    if (!settings) return;
    await saveSettings({ ...settings, overspend_notifications_enabled: enabled });
  }

  async function handleCheckForUpdate() {
    setChecking(true);
    setCheckResult(null);
    setCheckError(null);
    try {
      setCheckResult(await invoke<UpdateCheckResult>("check_for_update"));
    } catch (err) {
      setCheckError(String(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleExportData() {
    setExportResult(null);
    setExportError(null);

    const defaultPath = `pesantmoney-export-${new Date().toISOString().slice(0, 10)}.db`;
    let destination: string | null;
    try {
      destination = await save({
        defaultPath,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
    } catch (err) {
      setExportError(String(err));
      return;
    }

    if (!destination) {
      // User cancelled the dialog.
      return;
    }

    setExporting(true);
    try {
      await invoke("export_data", { destination });
      setExportResult(destination);
    } catch (err) {
      setExportError(String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section>
      <div className="content-header">
        <div>
          <h2 className="account-title">Settings</h2>
          <div className="account-title-meta">App preferences and update checks</div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="settings-panel">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Enable automatic update checks</div>
            <div className="settings-row-meta">
              Periodically checks GitHub Releases for a newer version of PesantMoney.
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings?.update_checks_enabled ?? false}
              disabled={settings === null}
              onChange={(e) => handleToggleUpdateChecks(e.target.checked)}
            />
            <span>{settings?.update_checks_enabled ? "On" : "Off"}</span>
          </label>
        </div>

        {settings?.update_checks_enabled && (
          <div className="settings-row">
            <div>
              <button type="button" onClick={handleCheckForUpdate} disabled={checking}>
                {checking ? "Checking…" : "Check for updates now"}
              </button>
              {checkResult && (
                <p className="settings-check-result">
                  {checkResult.available
                    ? `Update available: version ${checkResult.latest_version} (current: ${checkResult.current_version})`
                    : `You're up to date (${checkResult.current_version}).`}
                </p>
              )}
              {checkError && (
                <p className="settings-check-result" role="alert">
                  Couldn't check for updates: {checkError}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Notify me about upcoming bills</div>
            <div className="settings-row-meta">
              Native OS notification when a confirmed Recurring Item is due soon. Only fires while
              PesantMoney is running.
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings?.bill_notifications_enabled ?? false}
              disabled={settings === null}
              onChange={(e) => handleToggleBillNotifications(e.target.checked)}
            />
            <span>{settings?.bill_notifications_enabled ? "On" : "Off"}</span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Notify me about budget overspending</div>
            <div className="settings-row-meta">
              Native OS notification when a Category goes over its Assigned amount for the current
              Budget month. Only fires while PesantMoney is running.
            </div>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={settings?.overspend_notifications_enabled ?? false}
              disabled={settings === null}
              onChange={(e) => handleToggleOverspendNotifications(e.target.checked)}
            />
            <span>{settings?.overspend_notifications_enabled ? "On" : "Off"}</span>
          </label>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Automatic local backups</div>
            <div className="settings-row-meta">
              A snapshot of your database is taken automatically each time PesantMoney launches. The
              last 10 snapshots are kept in the app data folder; older ones are pruned automatically.
            </div>
            {backupStatus?.outcome === "success" && (
              <p className="settings-check-result">Last backup: {backupStatus.taken_at}</p>
            )}
            {backupStatus?.outcome === "failed" && (
              <p className="settings-check-result" role="alert">
                Last automatic backup failed: {backupStatus.message}
              </p>
            )}
            {backupStatusError && (
              <p className="settings-check-result" role="alert">
                Couldn't load backup status: {backupStatusError}
              </p>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="settings-row-label">Export data</div>
            <div className="settings-row-meta">
              Save a full copy of your database to a location of your choice — a USB drive, cloud
              storage folder, or anywhere else you'd like a portable backup.
            </div>
            <button type="button" onClick={handleExportData} disabled={exporting}>
              {exporting ? "Exporting…" : "Export data…"}
            </button>
            {exportResult && <p className="settings-check-result">Exported to {exportResult}.</p>}
            {exportError && (
              <p className="settings-check-result" role="alert">
                Export failed: {exportError}
              </p>
            )}
          </div>
        </div>

        <p className="settings-note">
          PesantMoney is offline-only for your financial data — no bank sync, no credentials, and no
          transaction data ever leaves this machine. The one exception is this update checker, which
          makes a network call to GitHub Releases to look for new versions. Turn off the toggle above
          if you want zero network access.
        </p>
      </div>
    </section>
  );
}

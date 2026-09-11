import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CategoriesScreen } from "../categories/CategoriesScreen";
import { MerchantsScreen } from "../merchants/MerchantsScreen";
import { RulesScreen } from "../rules/RulesScreen";
import { useCsvExport } from "../ui/useCsvExport";
import {
  BackupStatus,
  FolderBackupFile,
  FolderSyncResult,
  FolderSyncStatus,
  GDriveBackupFile,
  GDriveStatus,
  GDriveSyncResult,
  Settings,
  UpdateCheckResult,
} from "./types";
import { openUrl } from "@tauri-apps/plugin-opener";

type SettingsTab = "general" | "categories" | "rules" | "merchants";

const SETTINGS_TABS: { key: SettingsTab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "categories", label: "Categories" },
  { key: "rules", label: "Rules" },
  { key: "merchants", label: "Merchants" },
];

export function SettingsScreen() {
  const [tab, setTab] = useState<SettingsTab>("general");
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
  const {
    exportCsv,
    exporting: exportingCsv,
    result: csvExportResult,
    error: csvExportError,
  } = useCsvExport();

  // Google Drive state
  const [gdriveStatus, setGDriveStatus] = useState<GDriveStatus | null>(null);
  const [gdriveStatusError, setGDriveStatusError] = useState<string | null>(null);
  const [syncingGDrive, setSyncingGDrive] = useState(false);
  const [gdriveSyncResult, setGDriveSyncResult] = useState<GDriveSyncResult | null>(null);
  const [gdriveSyncError, setGDriveSyncError] = useState<string | null>(null);
  const [connectingGDrive, setConnectingGDrive] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [showManualCode, setShowManualCode] = useState(false);
  const [showCredentialsInput, setShowCredentialsInput] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [gdriveBackups, setGDriveBackups] = useState<GDriveBackupFile[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [showBackupsList, setShowBackupsList] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  // Dropbox / Cloud Storage Folder Sync state
  const [folderSyncStatus, setFolderSyncStatus] = useState<FolderSyncStatus | null>(null);
  const [syncingFolder, setSyncingFolder] = useState(false);
  const [folderSyncResult, setFolderSyncResult] = useState<FolderSyncResult | null>(null);
  const [folderSyncError, setFolderSyncError] = useState<string | null>(null);
  const [folderBackups, setFolderBackups] = useState<FolderBackupFile[]>([]);
  const [loadingFolderBackups, setLoadingFolderBackups] = useState(false);
  const [showFolderBackupsList, setShowFolderBackupsList] = useState(false);
  const [restoringFolderPath, setRestoringFolderPath] = useState<string | null>(null);

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

  async function refreshGDriveStatus() {
    try {
      setGDriveStatus(await invoke<GDriveStatus>("get_gdrive_status"));
      setGDriveStatusError(null);
    } catch (err) {
      setGDriveStatusError(String(err));
    }
  }

  async function refreshFolderSyncStatus() {
    try {
      setFolderSyncStatus(await invoke<FolderSyncStatus>("get_folder_sync_status"));
      setFolderSyncError(null);
    } catch (err) {
      setFolderSyncError(String(err));
    }
  }

  useEffect(() => {
    refresh();
    refreshBackupStatus();
    refreshGDriveStatus();
    refreshFolderSyncStatus();
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

  async function handleConnectGDrive() {
    setConnectingGDrive(true);
    setGDriveSyncError(null);
    try {
      const url = await invoke<string>("start_gdrive_auth");
      setAuthUrl(url);
      await openUrl(url);
    } catch (err) {
      setGDriveSyncError(String(err));
    } finally {
      setConnectingGDrive(false);
    }
  }

  async function handleSaveCredentials() {
    if (!clientId.trim()) return;
    try {
      await invoke("update_gdrive_credentials", {
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      });
      setShowCredentialsInput(false);
      await refreshGDriveStatus();
    } catch (err) {
      setGDriveSyncError(String(err));
    }
  }

  async function handleExchangeManualCode() {
    if (!manualCode.trim()) return;
    setConnectingGDrive(true);
    setGDriveSyncError(null);
    try {
      await invoke("exchange_gdrive_code", {
        code: manualCode.trim(),
        redirect_uri: "http://127.0.0.1:8989/oauth/callback",
      });
      setManualCode("");
      setShowManualCode(false);
      await refreshGDriveStatus();
    } catch (err) {
      setGDriveSyncError(String(err));
    } finally {
      setConnectingGDrive(false);
    }
  }

  async function handleDisconnectGDrive() {
    try {
      await invoke("disconnect_gdrive");
      setGDriveSyncResult(null);
      setGDriveSyncError(null);
      setShowBackupsList(false);
      await refreshGDriveStatus();
    } catch (err) {
      setGDriveSyncError(String(err));
    }
  }

  async function handleSyncGDriveNow() {
    setSyncingGDrive(true);
    setGDriveSyncResult(null);
    setGDriveSyncError(null);
    try {
      const res = await invoke<GDriveSyncResult>("sync_gdrive_now");
      setGDriveSyncResult(res);
      await refreshGDriveStatus();
      if (showBackupsList) {
        await handleFetchBackups();
      }
    } catch (err) {
      setGDriveSyncError(String(err));
    } finally {
      setSyncingGDrive(false);
    }
  }

  async function handleToggleGDriveAutoSync(enabled: boolean) {
    try {
      await invoke("set_gdrive_auto_sync", { enabled });
      await refreshGDriveStatus();
    } catch (err) {
      setGDriveSyncError(String(err));
    }
  }

  async function handleFetchBackups() {
    setLoadingBackups(true);
    try {
      const files = await invoke<GDriveBackupFile[]>("list_gdrive_backups");
      setGDriveBackups(files);
      setShowBackupsList(true);
    } catch (err) {
      setGDriveSyncError(String(err));
    } finally {
      setLoadingBackups(false);
    }
  }

  async function handleRestoreBackup(fileId: string) {
    if (!window.confirm("Are you sure you want to restore this backup? Your current local data will be safely backed up first.")) {
      return;
    }
    setRestoringId(fileId);
    setRestoreMessage(null);
    try {
      await invoke("restore_gdrive_backup", { file_id: fileId });
      setRestoreMessage("Database restored successfully from Google Drive backup!");
      await refreshBackupStatus();
      await refreshGDriveStatus();
    } catch (err) {
      setGDriveSyncError(`Restore failed: ${String(err)}`);
    } finally {
      setRestoringId(null);
    }
  }

  async function handleSelectSyncFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        await invoke("set_folder_sync_path", { folder_path: selected });
        await refreshFolderSyncStatus();
      }
    } catch (err) {
      setFolderSyncError(String(err));
    }
  }

  async function handleSyncFolderNow() {
    setSyncingFolder(true);
    setFolderSyncResult(null);
    setFolderSyncError(null);
    try {
      const res = await invoke<FolderSyncResult>("sync_folder_now");
      setFolderSyncResult(res);
      await refreshFolderSyncStatus();
      if (showFolderBackupsList) {
        await handleFetchFolderBackups();
      }
    } catch (err) {
      setFolderSyncError(String(err));
    } finally {
      setSyncingFolder(false);
    }
  }

  async function handleToggleFolderAutoSync(enabled: boolean) {
    try {
      await invoke("set_folder_auto_sync", { enabled });
      await refreshFolderSyncStatus();
    } catch (err) {
      setFolderSyncError(String(err));
    }
  }

  async function handleFetchFolderBackups() {
    setLoadingFolderBackups(true);
    try {
      const files = await invoke<FolderBackupFile[]>("list_folder_backups");
      setFolderBackups(files);
      setShowFolderBackupsList(true);
    } catch (err) {
      setFolderSyncError(String(err));
    } finally {
      setLoadingFolderBackups(false);
    }
  }

  async function handleRestoreFolderBackup(filePath: string) {
    if (!window.confirm("Are you sure you want to restore this backup? Your current local data will be safely backed up first.")) {
      return;
    }
    setRestoringFolderPath(filePath);
    setRestoreMessage(null);
    try {
      await invoke("restore_folder_backup", { file_path: filePath });
      setRestoreMessage("Database restored successfully from folder backup!");
      await refreshBackupStatus();
      await refreshFolderSyncStatus();
    } catch (err) {
      setFolderSyncError(`Restore failed: ${String(err)}`);
    } finally {
      setRestoringFolderPath(null);
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

      <div className="settings-tab-strip" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "categories" && <CategoriesScreen />}
      {tab === "rules" && <RulesScreen />}
      {tab === "merchants" && <MerchantsScreen />}

      {tab === "general" && (
        <>
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

        <div className="settings-row gdrive-card">
          <div>
            <div className="settings-row-label">Dropbox & Cloud Storage Folder Sync</div>
            <div className="settings-row-meta">
              Zero-setup sync! Select any synced folder on your computer (e.g. <code>~/Dropbox/PesantMoney</code> or <code>~/Google Drive/PesantMoney</code>). Dropbox or Google Drive Desktop automatically syncs your files across computers without any API keys or web login!
            </div>

            <div style={{ marginTop: "0.5rem" }}>
              <span className={`gdrive-status-badge ${folderSyncStatus?.configured ? "connected" : "disconnected"}`}>
                {folderSyncStatus?.configured
                  ? `✓ Synced to ${folderSyncStatus.sync_folder_path}`
                  : "No Sync Folder Selected"}
              </span>
            </div>

            <div className="gdrive-actions-row">
              <button type="button" onClick={handleSelectSyncFolder}>
                {folderSyncStatus?.configured ? "Change Sync Folder…" : "Select Dropbox / Cloud Folder…"}
              </button>

              {folderSyncStatus?.configured && (
                <>
                  <button
                    type="button"
                    className="gdrive-sync-btn"
                    onClick={handleSyncFolderNow}
                    disabled={syncingFolder}
                  >
                    {syncingFolder ? "Syncing to Folder…" : "🔄 Sync Now"}
                  </button>

                  <button
                    type="button"
                    onClick={handleFetchFolderBackups}
                    disabled={loadingFolderBackups}
                  >
                    {loadingFolderBackups ? "Loading…" : `View Folder Backups (${folderSyncStatus.backup_count})`}
                  </button>
                </>
              )}
            </div>

            {folderSyncStatus?.configured && (
              <>
                <div className="settings-row-meta" style={{ marginTop: "0.6rem" }}>
                  {folderSyncStatus.last_synced_at ? (
                    <span>Last synced: {folderSyncStatus.last_synced_at}</span>
                  ) : (
                    <span>Not synced yet</span>
                  )}
                </div>

                <label className="settings-toggle" style={{ marginTop: "0.6rem" }}>
                  <input
                    type="checkbox"
                    checked={folderSyncStatus.auto_sync}
                    onChange={(e) => handleToggleFolderAutoSync(e.target.checked)}
                  />
                  <span>Auto-sync to folder on app launch & changes</span>
                </label>
              </>
            )}

            {folderSyncResult?.outcome === "success" && (
              <p className="settings-check-result" style={{ color: "#10b981" }}>
                Sync successful! Copied to {folderSyncResult.dest_path} at {folderSyncResult.synced_at}.
              </p>
            )}

            {folderSyncResult?.outcome === "failed" && (
              <p className="settings-check-result" role="alert">
                Sync failed: {folderSyncResult.message}
              </p>
            )}

            {folderSyncError && (
              <p className="settings-check-result" role="alert">
                Folder Sync error: {folderSyncError}
              </p>
            )}

            {showFolderBackupsList && (
              <div style={{ marginTop: "1rem" }}>
                <div style={{ fontWeight: 500, fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                  Snapshots in Sync Folder ({folderBackups.length})
                </div>
                {folderBackups.length === 0 ? (
                  <p className="settings-row-meta">No snapshots found in sync folder.</p>
                ) : (
                  <table className="gdrive-backups-table">
                    <thead>
                      <tr>
                        <th>File Name</th>
                        <th>Modified</th>
                        <th>Size</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {folderBackups.map((file) => (
                        <tr key={file.path}>
                          <td>{file.name}</td>
                          <td>{file.modified_at ? new Date(file.modified_at).toLocaleString() : "-"}</td>
                          <td>{(file.size_bytes / 1024).toFixed(1)} KB</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleRestoreFolderBackup(file.path)}
                              disabled={restoringFolderPath === file.path}
                            >
                              {restoringFolderPath === file.path ? "Restoring…" : "Restore"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="settings-row gdrive-card">
          <div>
            <div className="settings-row-label">Google Drive Cloud Backup & Sync</div>
            <div className="settings-row-meta">
              Keep your database automatically backed up to Google Drive and sync changes on demand.
            </div>

            <div style={{ marginTop: "0.5rem" }}>
              <span className={`gdrive-status-badge ${gdriveStatus?.connected ? "connected" : "disconnected"}`}>
                {gdriveStatus?.connected
                  ? `✓ Connected ${gdriveStatus.user_email ? `as ${gdriveStatus.user_email}` : ""}`
                  : "Not Connected"}
              </span>
            </div>

            {gdriveStatusError && (
              <p className="settings-check-result" role="alert">
                Couldn't load Google Drive status: {gdriveStatusError}
              </p>
            )}

            {authUrl && (
              <p className="settings-row-meta" style={{ marginTop: "0.4rem" }}>
                Authorization link opened in browser.{" "}
                <a href={authUrl} target="_blank" rel="noreferrer">
                  Click here if it didn't open automatically
                </a>.
              </p>
            )}

            {gdriveStatus?.connected && (
              <>
                <div className="gdrive-actions-row">
                  <button
                    type="button"
                    className="gdrive-sync-btn"
                    onClick={handleSyncGDriveNow}
                    disabled={syncingGDrive}
                  >
                    {syncingGDrive ? "Syncing to Google Drive…" : "🔄 Sync Now"}
                  </button>

                  <button type="button" onClick={handleDisconnectGDrive}>
                    Disconnect
                  </button>

                  <button
                    type="button"
                    onClick={handleFetchBackups}
                    disabled={loadingBackups}
                  >
                    {loadingBackups ? "Loading backups…" : `View Remote Backups (${gdriveStatus.backup_count})`}
                  </button>
                </div>

                <div className="settings-row-meta" style={{ marginTop: "0.6rem" }}>
                  {gdriveStatus.last_synced_at ? (
                    <span>Last synced: {gdriveStatus.last_synced_at}</span>
                  ) : (
                    <span>Not synced yet</span>
                  )}
                </div>

                <label className="settings-toggle" style={{ marginTop: "0.6rem" }}>
                  <input
                    type="checkbox"
                    checked={gdriveStatus.auto_sync}
                    onChange={(e) => handleToggleGDriveAutoSync(e.target.checked)}
                  />
                  <span>Auto-sync database on launch & backups</span>
                </label>
              </>
            )}

            {!gdriveStatus?.connected && (
              <div className="gdrive-actions-row">
                <button
                  type="button"
                  className="gdrive-sync-btn"
                  onClick={handleConnectGDrive}
                  disabled={connectingGDrive}
                >
                  {connectingGDrive ? "Connecting…" : "Connect Google Drive"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowCredentialsInput(!showCredentialsInput)}
                >
                  {showCredentialsInput ? "Hide App Credentials" : "Configure OAuth App ID"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowManualCode(!showManualCode)}
                >
                  {showManualCode ? "Hide Manual Code" : "Enter Code Manually"}
                </button>
              </div>
            )}

            {showCredentialsInput && (
              <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem", background: "var(--paper-line)", padding: "0.75rem", borderRadius: "4px" }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 500 }}>Custom Google OAuth Credentials</div>
                <div className="settings-row-meta">
                  Create a free Desktop OAuth Client in Google Cloud Console, then paste your Client ID and Client Secret below.
                </div>
                <input
                  type="text"
                  placeholder="Google OAuth Client ID (e.g. xxx.apps.googleusercontent.com)"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  style={{ padding: "0.35rem 0.6rem", fontSize: "0.82rem" }}
                />
                <input
                  type="password"
                  placeholder="Google OAuth Client Secret"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  style={{ padding: "0.35rem 0.6rem", fontSize: "0.82rem" }}
                />
                <button
                  type="button"
                  onClick={handleSaveCredentials}
                  disabled={!clientId.trim()}
                  style={{ alignSelf: "flex-start" }}
                >
                  Save Credentials
                </button>
              </div>
            )}

            {showManualCode && (
              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}>
                <input
                  type="text"
                  placeholder="Paste Google Authorization Code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  style={{ flex: 1, padding: "0.35rem 0.6rem", fontSize: "0.85rem" }}
                />
                <button
                  type="button"
                  onClick={handleExchangeManualCode}
                  disabled={connectingGDrive || !manualCode.trim()}
                >
                  Save Code
                </button>
              </div>
            )}

            {gdriveSyncResult?.outcome === "success" && (
              <p className="settings-check-result" style={{ color: "#10b981" }}>
                Sync successful! Uploaded {gdriveSyncResult.file_name} at {gdriveSyncResult.synced_at}.
              </p>
            )}

            {gdriveSyncResult?.outcome === "failed" && (
              <p className="settings-check-result" role="alert">
                Sync failed: {gdriveSyncResult.message}
              </p>
            )}

            {gdriveSyncError && (
              <p className="settings-check-result" role="alert">
                Google Drive error: {gdriveSyncError}
              </p>
            )}

            {restoreMessage && (
              <p className="settings-check-result" style={{ color: "#10b981" }}>
                {restoreMessage}
              </p>
            )}

            {showBackupsList && (
              <div style={{ marginTop: "1rem" }}>
                <div style={{ fontWeight: 500, fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                  Remote Backups on Google Drive ({gdriveBackups.length})
                </div>
                {gdriveBackups.length === 0 ? (
                  <p className="settings-row-meta">No remote backups found.</p>
                ) : (
                  <table className="gdrive-backups-table">
                    <thead>
                      <tr>
                        <th>File Name</th>
                        <th>Created</th>
                        <th>Size</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gdriveBackups.map((file) => (
                        <tr key={file.id}>
                          <td>{file.name}</td>
                          <td>{file.created_time ? new Date(file.created_time).toLocaleString() : "-"}</td>
                          <td>{(file.size_bytes / 1024).toFixed(1)} KB</td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleRestoreBackup(file.id)}
                              disabled={restoringId === file.id}
                            >
                              {restoringId === file.id ? "Restoring…" : "Restore"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
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

            <div className="settings-row-meta settings-sub-action">
              Or export just your transactions as a CSV file, to open in a spreadsheet or import into
              another tool.
            </div>
            <button type="button" onClick={exportCsv} disabled={exportingCsv}>
              {exportingCsv ? "Exporting…" : "Export as CSV…"}
            </button>
            {csvExportResult && <p className="settings-check-result">{csvExportResult}</p>}
            {csvExportError && (
              <p className="settings-check-result" role="alert">
                {csvExportError}
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
        </>
      )}
    </section>
  );
}

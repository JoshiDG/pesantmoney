import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, UpdateCheckResult } from "./types";

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  async function refresh() {
    try {
      setSettings(await invoke<Settings>("get_settings"));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    refresh();
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

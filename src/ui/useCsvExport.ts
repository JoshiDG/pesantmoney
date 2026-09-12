import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

interface UseCsvExportResult {
  exportCsv: () => Promise<void>;
  exporting: boolean;
  result: string | null;
  error: string | null;
}

// Shared save-dialog -> export_transactions_csv -> status-message flow, used
// by SettingsScreen and (since #90) AllTransactionsScreen's Function Bar
// Export chip -- the deleted per-Account TransactionsScreen used it too,
// before this hook's export existed (see docs/adr and issue #21). The
// export is always global and unfiltered, regardless of which screen
// triggers it.
export function useCsvExport(): UseCsvExportResult {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportCsv() {
    setResult(null);
    setError(null);

    const defaultPath = `pesantmoney-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    let destination: string | null;
    try {
      destination = await save({
        defaultPath,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
    } catch (err) {
      setError(String(err));
      return;
    }

    if (!destination) {
      // User cancelled the dialog.
      return;
    }

    setExporting(true);
    try {
      const rowCount = await invoke<number>("export_transactions_csv", { destination });
      setResult(`Exported ${rowCount} transaction${rowCount === 1 ? "" : "s"} to ${destination}.`);
    } catch (err) {
      setError(`CSV export failed: ${err}`);
    } finally {
      setExporting(false);
    }
  }

  return { exportCsv, exporting, result, error };
}

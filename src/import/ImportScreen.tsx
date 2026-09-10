import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Account } from "../accounts/types";
import { formatCents } from "../transactions/types";
import { ImportMappingForm } from "./ImportMappingForm";
import {
  ColumnMapping,
  ImportFormat,
  ImportProfile,
  ImportResult,
  PreviewRow,
  previewRowToParsedTransaction,
} from "./types";

interface ImportScreenProps {
  account: Account;
  onBack: () => void;
}

const STATUS_LABELS: Record<PreviewRow["status"], string> = {
  new: "New",
  duplicate: "Already imported",
  needs_review: "Needs review",
};

function detectFormat(fileName: string): ImportFormat {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".ofx") || lower.endsWith(".qfx") ? "ofx" : "csv";
}

function defaultMapping(): ColumnMapping {
  return {
    date_column: 0,
    amount_column: 1,
    description_column: 2,
    sign_convention: "negative_is_debit",
    has_header_row: true,
  };
}

export function ImportScreen({ account, onBack }: ImportScreenProps) {
  const [profiles, setProfiles] = useState<ImportProfile[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileContents, setFileContents] = useState<string | null>(null);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [mapping, setMapping] = useState<ColumnMapping>(defaultMapping());
  const [institutionName, setInstitutionName] = useState("");
  const [saveAsProfile, setSaveAsProfile] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null);
  const [excludedRows, setExcludedRows] = useState<Set<number>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<ImportProfile[]>("list_import_profiles")
      .then(setProfiles)
      .catch((err) => setError(String(err)));
  }, []);

  async function handleFileChosen(file: File) {
    setFileName(file.name);
    setFormat(detectFormat(file.name));
    setPreviewRows(null);
    setResult(null);
    setError(null);
    setFileContents(await file.text());
  }

  async function runPreview() {
    if (fileContents == null) {
      return;
    }
    try {
      const rows = await invoke<PreviewRow[]>("preview_import", {
        account_id: account.id,
        file_contents: fileContents,
        format,
        mapping: format === "csv" ? mapping : null,
      });
      setPreviewRows(rows);
      setExcludedRows(new Set(rows.flatMap((row, i) => (row.status === "needs_review" ? [i] : []))));
      setResult(null);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  const includedRows = useMemo(
    () =>
      (previewRows ?? [])
        .map((row, index) => ({ row, index }))
        .filter(({ row, index }) => row.status !== "duplicate" && !excludedRows.has(index)),
    [previewRows, excludedRows],
  );

  function toggleRow(index: number) {
    setExcludedRows((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  async function handleCommit() {
    setCommitting(true);
    setError(null);
    try {
      if (saveAsProfile && format === "csv" && institutionName.trim() !== "") {
        await invoke("create_import_profile", { institution_name: institutionName, ...mapping });
        setProfiles(await invoke<ImportProfile[]>("list_import_profiles"));
      }
      const commitResult = await invoke<ImportResult>("commit_import", {
        account_id: account.id,
        transactions: includedRows.map(({ row }) => previewRowToParsedTransaction(row)),
      });
      setResult(commitResult);
      setPreviewRows(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setCommitting(false);
    }
  }

  return (
    <section>
      <button type="button" className="back-link" onClick={onBack}>
        &larr; {account.name}
      </button>

      <div className="content-header">
        <div>
          <h2 className="account-title">Import transactions</h2>
          <div className="account-title-meta">Into {account.name}, from a CSV, OFX, or QFX file</div>
        </div>
      </div>

      {error && <p role="alert">{error}</p>}

      <div className="import-step">
        <div className="import-csv-guidelines" role="note">
          <h3 className="import-csv-guidelines-heading">CSV format guidelines</h3>
          <ul>
            <li>Your file needs a Date, Amount, and Description column, in any order — map their
              positions below (0 is the first column).</li>
            <li>Dates: <code>YYYY-MM-DD</code> (e.g. 2026-08-01) or <code>MM/DD/YYYY</code> (e.g.
              8/1/2026).</li>
            <li>Amounts: plain numbers, optionally with a <code>$</code> and thousands commas (e.g.
              <code>$1,234.56</code>); parentheses (e.g. <code>(45.00)</code>) are treated as
              negative.</li>
            <li>Sign convention: choose whether a negative amount means money out (most exports) or
              money in (some credit card exports invert this) — pick whichever matches your file
              below.</li>
            <li>If the first row is column names rather than data, leave "First row is a header"
              checked.</li>
            <li>OFX and QFX files are auto-detected and don't need column mapping — these guidelines
              only apply to CSV files.</li>
          </ul>
        </div>
      </div>

      <div className="import-step">
        <input
          aria-label="Choose file to import"
          type="file"
          accept=".csv,.ofx,.qfx,text/csv"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) {
              handleFileChosen(file);
            }
          }}
        />
        {fileName && (
          <div className="import-file-meta">
            <span>{fileName}</span>
            <label className="import-format-toggle">
              <span>Format</span>
              <select
                aria-label="File format"
                value={format}
                onChange={(e) => {
                  setFormat(e.currentTarget.value as ImportFormat);
                  setPreviewRows(null);
                }}
              >
                <option value="csv">CSV</option>
                <option value="ofx">OFX / QFX</option>
              </select>
            </label>
          </div>
        )}
      </div>

      {fileContents != null && format === "csv" && (
        <div className="import-step">
          <ImportMappingForm
            profiles={profiles}
            mapping={mapping}
            onMappingChange={(next) => {
              setMapping(next);
              setPreviewRows(null);
            }}
            institutionName={institutionName}
            onInstitutionNameChange={setInstitutionName}
            onSelectProfile={(profile) => {
              setInstitutionName(profile.institution_name);
              setMapping({
                date_column: profile.date_column,
                amount_column: profile.amount_column,
                description_column: profile.description_column,
                sign_convention: profile.sign_convention,
                has_header_row: profile.has_header_row,
              });
              setPreviewRows(null);
            }}
          />
          <label className="import-field import-checkbox-field">
            <input
              aria-label="Save as import profile"
              type="checkbox"
              checked={saveAsProfile}
              onChange={(e) => setSaveAsProfile(e.currentTarget.checked)}
            />
            <span>Save this mapping as an Import Profile for {institutionName || "this institution"}</span>
          </label>
        </div>
      )}

      {fileContents != null && (
        <div className="import-step">
          <button type="button" onClick={runPreview}>
            Preview
          </button>
        </div>
      )}

      {previewRows && (
        <div className="import-step">
          <h3 className="import-preview-heading">
            Review ({includedRows.length} of {previewRows.length} will be imported)
          </h3>
          <div className="ledger import-preview-ledger">
            <div className="ledger-head">
              <span></span>
              <span>Date</span>
              <span>Description</span>
              <span>Amount</span>
              <span>Status</span>
            </div>
            {previewRows.map((row, index) => (
              <div
                className={`ledger-row import-preview-row import-status-${row.status}`}
                key={index}
              >
                <span>
                  <input
                    aria-label={`Include row ${index + 1}`}
                    type="checkbox"
                    disabled={row.status === "duplicate"}
                    checked={row.status !== "duplicate" && !excludedRows.has(index)}
                    onChange={() => toggleRow(index)}
                  />
                </span>
                <span>{row.date}</span>
                <span className="cell-description">{row.description}</span>
                <span className={`amount ${row.amount_cents < 0 ? "debit" : "credit"}`}>
                  {formatCents(row.amount_cents)}
                </span>
                <span className="import-status-label">{STATUS_LABELS[row.status]}</span>
              </div>
            ))}
          </div>

          <button type="submit" disabled={committing || includedRows.length === 0} onClick={handleCommit}>
            {committing ? "Importing…" : `Import ${includedRows.length} transaction${includedRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {result && (
        <p className="import-result">
          Imported {result.imported_count}, skipped {result.skipped_count} already-imported duplicate
          {result.skipped_count === 1 ? "" : "s"}.
        </p>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { ImportReport } from "./types";

type ImportDialogProps = {
  open: boolean;
  onClose: () => void;
  onImported?: (report: ImportReport) => void;
};

function isImportReport(value: unknown): value is ImportReport {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.source === "string" &&
    typeof record.imported === "number" &&
    typeof record.updated === "number" &&
    typeof record.skipped === "number"
  );
}

export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    if (!open) return;
    setDryRun(false);
    setLoading(false);
    setError(null);
    setReport(null);
  }, [open]);

  const handleImport = async (endpoint: string) => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
      });
      if (!res.ok) {
        const responseBody = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(responseBody?.error ?? "Import failed.");
        return;
      }
      const responseBody = (await res.json().catch(() => null)) as unknown;
      if (isImportReport(responseBody)) {
        setReport(responseBody);
        onImported?.(responseBody);
      } else {
        setError("Import completed with unexpected response.");
      }
    } catch {
      setError("Import failed.");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5, 7, 12, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 16,
      }}
    >
      <div
        className="card"
        style={{
          width: "min(680px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Import contacts</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Pull in your Mac Contacts or legacy iMessage CRM.
            </div>
          </div>
          <button className="btnSecondary" onClick={onClose} disabled={loading}>
            Close
          </button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
            disabled={loading}
          />
          Dry run (preview without saving)
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => handleImport("/api/mac/contacts/import")}
            disabled={loading}
          >
            {loading ? "Importing..." : "Import Mac Contacts"}
          </button>
          <button
            className="btnSecondary"
            onClick={() => handleImport("/api/mac/contacts/import-legacy")}
            disabled={loading}
          >
            {loading ? "Importing..." : "Import Legacy iMessage CRM"}
          </button>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="spinner" />
              <span className="muted" style={{ fontSize: 12 }}>
                Import in progress...
              </span>
            </div>
          )}
        </div>

        {error && <div className="error">{error}</div>}

        {report && (
          <div className="notice" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontWeight: 600 }}>Import report</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
              <span>Source: {report.source}</span>
              <span>Processed: {report.total_processed}</span>
              <span>Imported: {report.imported}</span>
              <span>Updated: {report.updated}</span>
              <span>Skipped: {report.skipped}</span>
            </div>
            {report.errors.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontWeight: 600, fontSize: 12 }}>Errors</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {report.errors.slice(0, 8).map((entry, index) => (
                    <li key={`${entry.reason}-${index}`}>
                      {(entry.name ? `${entry.name}: ` : "")} {entry.reason}
                    </li>
                  ))}
                  {report.errors.length > 8 && (
                    <li>Plus {report.errors.length - 8} more.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

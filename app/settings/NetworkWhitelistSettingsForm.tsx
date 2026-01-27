"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type NetworkWhitelistEntry = {
  domain: string;
  enabled: boolean;
  created_at: string;
};

type NetworkWhitelistResponse = {
  entries: NetworkWhitelistEntry[];
  error?: string;
};

type NetworkWhitelistEntryResponse = {
  entry: NetworkWhitelistEntry;
  error?: string;
};

function sortEntries(entries: NetworkWhitelistEntry[]) {
  return [...entries].sort((a, b) => a.domain.localeCompare(b.domain));
}

export function NetworkWhitelistSettingsForm() {
  const [entries, setEntries] = useState<NetworkWhitelistEntry[]>([]);
  const [draftDomain, setDraftDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canAdd = useMemo(() => !!draftDomain.trim(), [draftDomain]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/network-whitelist", {
        cache: "no-store",
      });
      const json = (await res
        .json()
        .catch(() => null)) as NetworkWhitelistResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to load network whitelist");
      }
      setEntries(sortEntries(json?.entries || []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load network whitelist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upsertEntry = useCallback((entry: NetworkWhitelistEntry) => {
    setEntries((prev) => {
      const index = prev.findIndex((item) => item.domain === entry.domain);
      if (index === -1) {
        return sortEntries([...prev, entry]);
      }
      const next = [...prev];
      next[index] = entry;
      return sortEntries(next);
    });
  }, []);

  const addDomain = useCallback(async () => {
    if (!draftDomain.trim()) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/network-whitelist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: draftDomain }),
      });
      const json = (await res
        .json()
        .catch(() => null)) as NetworkWhitelistEntryResponse | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to add domain");
      }
      if (json?.entry) {
        upsertEntry(json.entry);
      }
      setDraftDomain("");
      setNotice("Added.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to add domain");
    } finally {
      setSaving(false);
    }
  }, [draftDomain, upsertEntry]);

  const toggleDomain = useCallback(
    async (entry: NetworkWhitelistEntry, enabled: boolean) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/settings/network-whitelist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: entry.domain, enabled }),
        });
        const json = (await res
          .json()
          .catch(() => null)) as NetworkWhitelistEntryResponse | null;
        if (!res.ok) {
          throw new Error(json?.error || "failed to update domain");
        }
        if (json?.entry) {
          upsertEntry(json.entry);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to update domain");
      } finally {
        setSaving(false);
      }
    },
    [upsertEntry]
  );

  const removeDomain = useCallback(async (domain: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/settings/network-whitelist?domain=${encodeURIComponent(domain)}`,
        { method: "DELETE" }
      );
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        throw new Error(json?.error || "failed to remove domain");
      }
      setEntries((prev) => prev.filter((item) => item.domain !== domain));
      setNotice("Removed.");
      setTimeout(() => setNotice(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to remove domain");
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Network Whitelist</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Domains builders can access when whitelist mode is enabled.
          </div>
        </div>
        <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
          Refresh
        </button>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="badge">{notice}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && (
        <>
          <div className="field" style={{ gap: 8 }}>
            <div className="fieldLabel muted">Add domain</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                placeholder="example.com"
                value={draftDomain}
                onChange={(e) => setDraftDomain(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addDomain();
                  }
                }}
                disabled={saving}
              />
              <button className="btn" onClick={() => void addDomain()} disabled={saving || !canAdd}>
                Add
              </button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Enter hostnames only (no paths).
            </div>
          </div>

          {entries.length === 0 && <div className="muted">No whitelist entries yet.</div>}

          {entries.length > 0 && (
            <div className="field" style={{ gap: 8 }}>
              <div className="fieldLabel muted">Domains</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {entries.map((entry) => (
                  <div
                    key={entry.domain}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        disabled={saving}
                        onChange={(e) => void toggleDomain(entry, e.target.checked)}
                      />
                      <code>{entry.domain}</code>
                    </label>
                    <button
                      className="btnSecondary"
                      onClick={() => void removeDomain(entry.domain)}
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

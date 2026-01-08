"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type IsolationMode = "local" | "vm" | "vm+container";
type VmSize = "small" | "medium" | "large" | "xlarge";

type VmResponse = {
  project: {
    id: string;
    name: string;
    isolation_mode: IsolationMode;
    vm_size: VmSize;
  };
  vm: {
    project_id: string;
    gcp_instance_name: string | null;
    gcp_zone: string | null;
    external_ip: string | null;
    internal_ip: string | null;
    status: string;
    size: VmSize | null;
    created_at: string | null;
    last_started_at: string | null;
    last_activity_at: string | null;
    last_error: string | null;
    total_hours_used: number;
  };
  error?: string;
};

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "n/a";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

export function VMPanel({ repoId }: { repoId: string }) {
  const [data, setData] = useState<VmResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (options?: { preserveNotice?: boolean }) => {
    setLoading(true);
    setError(null);
    if (!options?.preserveNotice) setNotice(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/vm`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as VmResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load VM data");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load VM data");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = useCallback(
    async (patchBody: Partial<Pick<VmResponse["project"], "isolation_mode" | "vm_size">>) => {
      if (!data) return;
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/vm`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
        const json = (await res.json().catch(() => null)) as VmResponse | null;
        if (!res.ok) throw new Error(json?.error || "failed to update VM settings");
        setData(json);
        setNotice("Saved.");
        setTimeout(() => setNotice(null), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to update VM settings");
      } finally {
        setSaving(false);
      }
    },
    [data, repoId]
  );

  const status = data?.vm?.status || "not_provisioned";
  const lastActivity = formatTimestamp(
    data?.vm?.last_activity_at ?? data?.vm?.last_started_at ?? null
  );
  const lastError = data?.vm?.last_error || "n/a";
  const notProvisioned = status === "not_provisioned" || status === "deleted";

  const lifecycleReason = useMemo(() => {
    if (notProvisioned) {
      return "VM not provisioned yet. Provisioning will be available in WO-2026-039.";
    }
    return "VM lifecycle actions are not implemented yet (WO-2026-039).";
  }, [notProvisioned]);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>VM Isolation</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Configure per-project VM mode and view instance metadata.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btnSecondary" onClick={() => void load()} disabled={loading || saving}>
            Refresh
          </button>
        </div>
      </div>

      {!!error && <div className="error">{error}</div>}
      {!!notice && <div className="badge">{notice}</div>}
      {loading && <div className="muted">Loading...</div>}

      {!loading && data && (
        <>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", alignItems: "start" }}>
            <div className="field">
              <div className="fieldLabel muted">Isolation mode</div>
              <select
                className="select"
                value={data.project.isolation_mode}
                onChange={(e) =>
                  void patch({
                    isolation_mode: e.target.value as IsolationMode,
                  })
                }
                disabled={saving}
              >
                <option value="local">Local (host)</option>
                <option value="vm">VM</option>
                <option value="vm+container">VM + container</option>
              </select>
            </div>

            <div className="field">
              <div className="fieldLabel muted">VM size</div>
              <select
                className="select"
                value={data.project.vm_size}
                onChange={(e) =>
                  void patch({
                    vm_size: e.target.value as VmSize,
                  })
                }
                disabled={saving}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
                <option value="xlarge">XLarge</option>
              </select>
            </div>

            <div className="field">
              <div className="fieldLabel muted">Status</div>
              <div className="badge">{status}</div>
            </div>

            <div className="field">
              <div className="fieldLabel muted">Last activity</div>
              <div>{lastActivity}</div>
            </div>

            <div className="field">
              <div className="fieldLabel muted">Last error</div>
              <div className={lastError === "n/a" ? "muted" : undefined}>{lastError}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn" disabled>
              Provision
            </button>
            <button className="btnSecondary" disabled>
              Start
            </button>
            <button className="btnSecondary" disabled>
              Stop
            </button>
            <button className="btnSecondary" disabled>
              Resize
            </button>
            <button className="btnSecondary" disabled>
              Delete
            </button>
          </div>

          <div className="muted" style={{ fontSize: 12 }}>
            {lifecycleReason}
          </div>
        </>
      )}
    </section>
  );
}

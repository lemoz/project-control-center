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
    provider: string | null;
    repo_path: string | null;
    gcp_instance_id: string | null;
    gcp_instance_name: string | null;
    gcp_project: string | null;
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

type LifecycleAction = "provision" | "start" | "stop" | "resize" | "delete";

const IN_PROGRESS_STATUSES = new Set(["provisioning", "installing", "syncing"]);
const PROVISION_POLL_INTERVAL_MS = 4000;

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
  const [lifecycleAction, setLifecycleAction] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (options?: { preserveNotice?: boolean; silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    if (!options?.silent) setError(null);
    if (!options?.preserveNotice) setNotice(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/vm`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as VmResponse | null;
      if (!res.ok) throw new Error(json?.error || "failed to load VM data");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load VM data");
    } finally {
      if (!options?.silent) setLoading(false);
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

  const runLifecycleAction = useCallback(
    async (action: LifecycleAction) => {
      if (!data) return;
      setLifecycleAction(action);
      setError(null);
      setNotice(null);

      let url = `/api/repos/${encodeURIComponent(repoId)}/vm`;
      let method = "POST";
      let body: Record<string, unknown> | undefined;

      switch (action) {
        case "provision":
          url = `${url}/provision`;
          break;
        case "start":
          url = `${url}/start`;
          break;
        case "stop":
          url = `${url}/stop`;
          break;
        case "resize":
          url = `${url}/resize`;
          method = "PUT";
          body = { vm_size: data.project.vm_size };
          break;
        case "delete":
          method = "DELETE";
          break;
      }

      try {
        const res = await fetch(url, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const json = (await res.json().catch(() => null)) as VmResponse | null;
        if (!res.ok) {
          throw new Error(json?.error || `failed to ${action} VM`);
        }
        if (!json) {
          throw new Error(`invalid response while trying to ${action} VM`);
        }
        setData(json);
        const successMessage =
          action === "provision"
            ? "Provisioned."
            : action === "start"
              ? "Started."
              : action === "stop"
                ? "Stopped."
                : action === "resize"
                  ? "Resized."
                  : "Deleted.";
        setNotice(successMessage);
        setTimeout(() => setNotice(null), 2500);
      } catch (e) {
        setError(e instanceof Error ? e.message : `failed to ${action} VM`);
      } finally {
        setLifecycleAction(null);
      }
    },
    [data, repoId]
  );

  const status = data?.vm?.status || "not_provisioned";
  const lastActivity = formatTimestamp(
    data?.vm?.last_activity_at ?? data?.vm?.last_started_at ?? null
  );
  const lastError = data?.vm?.last_error || "n/a";
  const isInProgressStatus = IN_PROGRESS_STATUSES.has(status);
  const allowAnyAction = status === "error";
  const actionLocked =
    loading || saving || lifecycleAction !== null || isInProgressStatus;
  const canProvision =
    !actionLocked && (allowAnyAction || status === "not_provisioned" || status === "deleted");
  const canStart = !actionLocked && (allowAnyAction || status === "stopped");
  const canStop = !actionLocked && (allowAnyAction || status === "running");
  const canResize =
    !actionLocked && (allowAnyAction || status === "running" || status === "stopped");
  const canDelete = !actionLocked && (allowAnyAction || status !== "deleted");

  useEffect(() => {
    if (!lifecycleAction && !isInProgressStatus) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await load({ preserveNotice: true, silent: true });
    };
    void poll();
    const interval = setInterval(poll, PROVISION_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [lifecycleAction, isInProgressStatus, load]);

  const lifecycleReason = useMemo(() => {
    switch (status) {
      case "not_provisioned":
        return "VM not provisioned yet. Use Provision to create a GCP instance.";
      case "provisioning":
        return "Provisioning VM instance. This can take a few minutes.";
      case "installing":
        return "Installing VM prerequisites (git, node, etc.).";
      case "syncing":
        return "Syncing repo to VM. This can take a few minutes.";
      case "running":
        return "VM is running. Stop or resize when needed.";
      case "stopped":
        return "VM is stopped. Start to resume or resize while stopped.";
      case "deleted":
        return "VM deleted. Provision to create a new instance.";
      case "error":
        return "VM action failed. Review the last error and retry.";
      default:
        return "VM status unknown. Refresh to retry.";
    }
  }, [status]);

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
          <button
            className="btnSecondary"
            onClick={() => void load()}
            disabled={loading || saving}
          >
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
            <button
              className="btn"
              disabled={!canProvision}
              onClick={() => void runLifecycleAction("provision")}
            >
              {lifecycleAction === "provision" ? "Provisioning..." : "Provision"}
            </button>
            <button
              className="btnSecondary"
              disabled={!canStart}
              onClick={() => void runLifecycleAction("start")}
            >
              {lifecycleAction === "start" ? "Starting..." : "Start"}
            </button>
            <button
              className="btnSecondary"
              disabled={!canStop}
              onClick={() => void runLifecycleAction("stop")}
            >
              {lifecycleAction === "stop" ? "Stopping..." : "Stop"}
            </button>
            <button
              className="btnSecondary"
              disabled={!canResize}
              onClick={() => void runLifecycleAction("resize")}
            >
              {lifecycleAction === "resize" ? "Resizing..." : "Resize"}
            </button>
            <button
              className="btnSecondary"
              disabled={!canDelete}
              onClick={() => void runLifecycleAction("delete")}
            >
              {lifecycleAction === "delete" ? "Deleting..." : "Delete"}
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

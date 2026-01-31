"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type RepoSummary = {
  id: string;
  name: string;
  status: string;
  stage: string;
  priority: number;
  next_work_orders: Array<{
    id: string;
    title: string;
    status: string;
    priority: number;
  }>;
};

type WorkOrder = {
  id: string;
  title: string;
  status: string;
  priority: number;
};

type MeetingState = {
  status: string;
  bot_name: string | null;
};

type OutputMediaState = {
  enabled: boolean;
  mode: string;
  project_id: string | null;
  meeting_id: string | null;
  output_url: string | null;
  last_error: string | null;
  updated_at: string;
};

type OutputMediaResponse = {
  meeting: MeetingState;
  output_media: OutputMediaState;
};

type MeetingCommunication = {
  id: string;
  intent: string;
  summary: string;
  body: string | null;
  payload: string | null;
  created_at: string;
};

type MeetingNote = {
  id: string;
  kind: string;
  text: string;
  timestamp: string;
};

const OUTPUT_POLL_MS = 4000;
const PROJECT_POLL_MS = 15000;
const WORK_ORDER_POLL_MS = 6000;
const NOTES_POLL_MS = 4500;
const MAX_NOTES = 6;
const MAX_PROJECTS = 4;

const KANBAN_COLUMNS = [
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "building", label: "In progress", statuses: ["building", "testing", "ai_review", "queued"] },
  { id: "review", label: "Review", statuses: ["you_review", "security_hold"] },
  { id: "done", label: "Done", statuses: ["done"] },
];

function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString();
}

function safeJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseMeetingNote(row: MeetingCommunication): MeetingNote | null {
  const payload = safeJson(row.payload);
  const kind =
    (typeof payload?.kind === "string" && payload.kind) ||
    (row.intent === "status" ? "summary" : "note");
  const text =
    (typeof payload?.note === "string" && payload.note.trim()) ||
    (typeof payload?.action_title === "string" && payload.action_title.trim()) ||
    row.summary;
  if (!text) return null;
  const timestamp =
    (typeof payload?.note_timestamp === "string" && payload.note_timestamp) ||
    (typeof payload?.recorded_at === "string" && payload.recorded_at) ||
    row.created_at;
  return {
    id: row.id,
    kind,
    text,
    timestamp,
  };
}

function statusLabel(value: string | null | undefined): string {
  if (!value) return "unknown";
  return value.replace(/_/g, " ");
}

export default function RecallScreenSharePage() {
  const searchParams = useSearchParams();
  const [outputMedia, setOutputMedia] = useState<OutputMediaState | null>(null);
  const [meeting, setMeeting] = useState<MeetingState | null>(null);
  const [projects, setProjects] = useState<RepoSummary[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [communications, setCommunications] = useState<MeetingCommunication[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryProjectId = searchParams.get("project_id");
  const queryMeetingId = searchParams.get("meeting_id");

  const effectiveProjectId = useMemo(() => {
    return outputMedia?.project_id || queryProjectId || projects[0]?.id || null;
  }, [outputMedia?.project_id, queryProjectId, projects]);

  const effectiveMeetingId = useMemo(() => {
    return outputMedia?.meeting_id || queryMeetingId || null;
  }, [outputMedia?.meeting_id, queryMeetingId]);

  useEffect(() => {
    let active = true;
    const loadOutputMedia = async () => {
      try {
        const res = await fetch("/api/meetings/output-media", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as OutputMediaResponse;
        if (!active) return;
        setOutputMedia(data.output_media ?? null);
        setMeeting(data.meeting ?? null);
        setLastUpdated(new Date().toISOString());
        setError(data.output_media?.last_error ?? null);
      } catch {
        if (active) setError("Screen share state unavailable.");
      }
    };

    void loadOutputMedia();
    const interval = setInterval(loadOutputMedia, OUTPUT_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      try {
        const res = await fetch("/api/repos", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as RepoSummary[];
        if (!active) return;
        setProjects(Array.isArray(data) ? data : []);
      } catch {
        if (active) setProjects([]);
      }
    };

    void loadProjects();
    const interval = setInterval(loadProjects, PROJECT_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!effectiveProjectId) {
      setWorkOrders([]);
      return;
    }
    let active = true;
    const loadWorkOrders = async () => {
      try {
        const res = await fetch(`/api/repos/${encodeURIComponent(effectiveProjectId)}/work-orders`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { work_orders?: WorkOrder[] };
        if (!active) return;
        setWorkOrders(Array.isArray(data.work_orders) ? data.work_orders : []);
      } catch {
        if (active) setWorkOrders([]);
      }
    };

    void loadWorkOrders();
    const interval = setInterval(loadWorkOrders, WORK_ORDER_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [effectiveProjectId]);

  useEffect(() => {
    if (!effectiveMeetingId) {
      setCommunications([]);
      return;
    }
    let active = true;
    const loadNotes = async () => {
      const query = new URLSearchParams({
        meeting_id: effectiveMeetingId,
      });
      if (effectiveProjectId) {
        query.set("project_id", effectiveProjectId);
      }
      try {
        const res = await fetch(`/api/meetings/notes?${query.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { communications?: MeetingCommunication[] };
        if (!active) return;
        setCommunications(Array.isArray(data.communications) ? data.communications : []);
      } catch {
        if (active) setCommunications([]);
      }
    };

    void loadNotes();
    const interval = setInterval(loadNotes, NOTES_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [effectiveMeetingId, effectiveProjectId]);

  const selectedProject = useMemo(() => {
    if (!projects.length) return null;
    if (!effectiveProjectId) return projects[0] ?? null;
    return projects.find((project) => project.id === effectiveProjectId) ?? projects[0] ?? null;
  }, [projects, effectiveProjectId]);

  const projectHighlights = useMemo(() => {
    if (!projects.length) return [];
    const sorted = [...projects].sort((a, b) => a.priority - b.priority);
    return sorted.slice(0, MAX_PROJECTS);
  }, [projects]);

  const kanbanColumns = useMemo(() => {
    const buckets: Record<string, WorkOrder[]> = {};
    for (const column of KANBAN_COLUMNS) {
      buckets[column.id] = [];
    }
    for (const workOrder of workOrders) {
      const column = KANBAN_COLUMNS.find((entry) =>
        entry.statuses.includes(workOrder.status)
      );
      const bucket = column ? buckets[column.id] : null;
      if (bucket) bucket.push(workOrder);
    }
    return KANBAN_COLUMNS.map((column) => ({
      ...column,
      items: buckets[column.id] ?? [],
    }));
  }, [workOrders]);

  const notes = useMemo(() => {
    return communications
      .map(parseMeetingNote)
      .filter((note): note is MeetingNote => Boolean(note))
      .slice(0, MAX_NOTES);
  }, [communications]);

  const screenShareEnabled = outputMedia?.enabled ?? false;

  return (
    <>
      <style jsx global>{`
        :root {
          --screen-bg: radial-gradient(circle at top, #fdf5e6 0%, #e7f1fb 55%, #d9e6f2 100%);
          --text-main: #1f2937;
          --text-muted: rgba(71, 85, 105, 0.75);
          --panel-bg: rgba(255, 255, 255, 0.82);
          --panel-border: rgba(148, 163, 184, 0.35);
          --panel-soft: rgba(248, 250, 252, 0.85);
          --accent: #0f766e;
          --accent-strong: #0e7490;
          --danger: #b91c1c;
        }

        html,
        body {
          background: var(--screen-bg);
          color: var(--text-main);
        }

        .nav-bar,
        .chat-widget {
          display: none !important;
        }

        .container {
          max-width: none;
          padding: 0;
        }
      `}</style>
      <div className={`meeting-output ${screenShareEnabled ? "" : "paused"}`}>
        {!screenShareEnabled ? (
          <div className="paused-card">
            <div className="paused-eyebrow">Recall.ai Output Media</div>
            <h1>Screen share paused</h1>
            <p>Resume from the PCC canvas to show live project status and notes.</p>
            {error && <div className="error-card">{error}</div>}
          </div>
        ) : (
          <>
            <header className="meeting-header">
              <div>
                <div className="eyebrow">Project Control Center</div>
                <h1>Meeting dashboard</h1>
                <p>Live portfolio + meeting notes</p>
              </div>
              <div className="status-stack">
                <div className={`pill status-${meeting?.status ?? "unknown"}`}>
                  Meeting {statusLabel(meeting?.status)}
                </div>
                <div className="pill share-on">Screen share on</div>
                {selectedProject && (
                  <div className="pill project-pill">{selectedProject.name}</div>
                )}
              </div>
            </header>

            <section className="meeting-grid">
              <div className="panel">
                <div className="panel-header">
                  <h2>Portfolio status</h2>
                  <span className="panel-meta">{projects.length} projects tracked</span>
                </div>
                <div className="project-list">
                  {projectHighlights.map((project) => (
                    <div
                      key={project.id}
                      className={`project-row ${
                        project.id === selectedProject?.id ? "active" : ""
                      }`}
                    >
                      <div>
                        <div className="project-name">{project.name}</div>
                        <div className="project-meta">
                          {project.stage} / {project.status}
                        </div>
                      </div>
                      <div className="project-wo">
                        {project.next_work_orders.length
                          ? project.next_work_orders[0]?.title
                          : "No next work orders"}
                      </div>
                    </div>
                  ))}
                  {!projectHighlights.length && (
                    <div className="panel-empty">No projects available.</div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header">
                  <h2>Meeting notes</h2>
                  <span className="panel-meta">
                    {effectiveMeetingId ? `Meeting ${effectiveMeetingId}` : "No meeting linked"}
                  </span>
                </div>
                <div className="notes-list">
                  {notes.map((note) => (
                    <div key={note.id} className="note-row">
                      <div className="note-time">{formatTime(note.timestamp)}</div>
                      <div>
                        <div className="note-kind">{note.kind.replace(/_/g, " ")}</div>
                        <div className="note-text">{note.text}</div>
                      </div>
                    </div>
                  ))}
                  {!notes.length && (
                    <div className="panel-empty">
                      {effectiveMeetingId ? "No notes captured yet." : "Waiting for meeting notes."}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel kanban">
                <div className="panel-header">
                  <h2>Kanban snapshot</h2>
                  <span className="panel-meta">
                    {selectedProject ? selectedProject.name : "No project selected"}
                  </span>
                </div>
                <div className="kanban-columns">
                  {kanbanColumns.map((column) => (
                    <div key={column.id} className="kanban-column">
                      <div className="kanban-header">
                        <span>{column.label}</span>
                        <span className="kanban-count">{column.items.length}</span>
                      </div>
                      <div className="kanban-items">
                        {column.items.slice(0, 3).map((item) => (
                          <div key={item.id} className="kanban-item">
                            <span className="kanban-title">{item.title}</span>
                            <span className="kanban-pill">P{item.priority}</span>
                          </div>
                        ))}
                        {!column.items.length && (
                          <div className="kanban-empty">No work orders</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="footer">
              <span>Updated {lastUpdated ? formatTime(lastUpdated) : "just now"}</span>
              {outputMedia?.mode && <span>Mode: {outputMedia.mode.replace(/_/g, " ")}</span>}
              {error && <span className="error-inline">{error}</span>}
            </div>
          </>
        )}
      </div>
      <style jsx>{`
        :global(body) {
          font-family: "Space Grotesk", "Avenir Next", "Futura", sans-serif;
        }

        .meeting-output {
          min-height: 100vh;
          padding: 32px 48px 40px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .meeting-output.paused {
          align-items: center;
          justify-content: center;
        }

        .paused-card {
          background: rgba(255, 255, 255, 0.82);
          padding: 36px 40px;
          border-radius: 22px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);
          max-width: 520px;
          text-align: center;
        }

        .paused-eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.18em;
          font-size: 0.72rem;
          color: rgba(71, 85, 105, 0.75);
        }

        .paused-card h1 {
          margin: 12px 0 8px;
          font-size: 2.2rem;
        }

        .paused-card p {
          margin: 0;
          color: rgba(71, 85, 105, 0.8);
        }

        .error-card {
          margin-top: 18px;
          background: rgba(254, 226, 226, 0.9);
          color: var(--danger);
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 0.9rem;
        }

        .meeting-header {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          flex-wrap: wrap;
        }

        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.2em;
          font-size: 0.7rem;
          color: rgba(71, 85, 105, 0.7);
        }

        .meeting-header h1 {
          margin: 6px 0 4px;
          font-size: clamp(2.1rem, 4vw, 3.1rem);
        }

        .meeting-header p {
          margin: 0;
          color: rgba(71, 85, 105, 0.8);
        }

        .status-stack {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
        }

        .pill {
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          border: 1px solid rgba(148, 163, 184, 0.5);
          background: rgba(255, 255, 255, 0.7);
        }

        .status-active {
          border-color: rgba(34, 197, 94, 0.6);
          color: #166534;
        }

        .status-joining {
          border-color: rgba(250, 204, 21, 0.7);
          color: #92400e;
        }

        .status-ended {
          border-color: rgba(248, 113, 113, 0.7);
          color: #991b1b;
        }

        .share-on {
          border-color: rgba(14, 116, 144, 0.6);
          color: #0f172a;
        }

        .project-pill {
          border-color: rgba(14, 116, 144, 0.5);
          color: #0f172a;
        }

        .meeting-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
        }

        .panel {
          background: var(--panel-bg);
          border-radius: 20px;
          padding: 18px 20px;
          border: 1px solid var(--panel-border);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
        }

        .panel-header h2 {
          margin: 0;
          font-size: 1rem;
          text-transform: uppercase;
          letter-spacing: 0.16em;
        }

        .panel-meta {
          font-size: 0.8rem;
          color: var(--text-muted);
        }

        .project-list,
        .notes-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .project-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 12px;
          border-radius: 14px;
          background: var(--panel-soft);
        }

        .project-row.active {
          border: 1px solid rgba(14, 116, 144, 0.4);
          background: rgba(226, 232, 240, 0.85);
        }

        .project-name {
          font-weight: 600;
        }

        .project-meta {
          font-size: 0.78rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .project-wo {
          font-size: 0.85rem;
          color: rgba(30, 41, 59, 0.8);
          max-width: 240px;
          text-align: right;
        }

        .note-row {
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 12px;
          background: var(--panel-soft);
        }

        .note-time {
          font-variant-numeric: tabular-nums;
          font-size: 0.8rem;
          color: var(--text-muted);
        }

        .note-kind {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--accent);
        }

        .note-text {
          font-size: 0.92rem;
          color: rgba(30, 41, 59, 0.9);
        }

        .panel-empty {
          padding: 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 0.9rem;
          background: var(--panel-soft);
          border-radius: 14px;
        }

        .kanban {
          grid-column: span 2;
        }

        .kanban-columns {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .kanban-column {
          background: var(--panel-soft);
          border-radius: 14px;
          padding: 12px;
          border: 1px solid rgba(226, 232, 240, 0.9);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .kanban-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: rgba(71, 85, 105, 0.8);
        }

        .kanban-count {
          font-size: 0.85rem;
          color: #0f172a;
        }

        .kanban-items {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .kanban-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 0.85rem;
        }

        .kanban-title {
          max-width: 160px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .kanban-pill {
          font-size: 0.7rem;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.2);
        }

        .kanban-empty {
          font-size: 0.8rem;
          color: var(--text-muted);
          text-align: center;
        }

        .footer {
          display: flex;
          justify-content: space-between;
          font-size: 0.78rem;
          color: var(--text-muted);
        }

        .error-inline {
          color: var(--danger);
        }

        @media (max-width: 980px) {
          .meeting-output {
            padding: 24px;
          }

          .meeting-grid {
            grid-template-columns: 1fr;
          }

          .kanban {
            grid-column: span 1;
          }

          .kanban-columns {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .status-stack {
            align-items: flex-start;
          }
        }
      `}</style>
    </>
  );
}

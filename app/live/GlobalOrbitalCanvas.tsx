"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
} from "react";
import styles from "./live.module.css";
import { useCanvasInteraction } from "../playground/canvas/useCanvasInteraction";
import { OrbitalGravityVisualization } from "../playground/canvas/visualizations/OrbitalGravityViz";
import { useProjectsVisualization } from "../playground/canvas/useProjectsVisualization";
import type {
  ProjectNode,
  VisualizationNode,
} from "../playground/canvas/types";
import {
  setCanvasVoiceState,
  subscribeCanvasCommands,
  type CanvasVoiceEscalation,
  type CanvasVoiceNode,
  type CanvasVoiceShift,
} from "../landing/components/VoiceWidget/voiceClientTools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatActivity(value: Date | null): string {
  if (!value) return "No activity yet";
  return value.toLocaleString();
}

function formatHealth(value: number): string {
  if (value >= 0.8) return "Healthy";
  if (value >= 0.5) return "Attention needed";
  if (value >= 0.3) return "Stalled";
  return "Failing";
}

function healthColor(value: number): string {
  if (value >= 0.8) return "#22c55e";
  if (value >= 0.5) return "#fbbf24";
  if (value >= 0.3) return "#f97316";
  return "#f87171";
}

const GLOBAL_SESSION_STATES = new Set([
  "onboarding",
  "briefing",
  "autonomous",
  "debrief",
  "ended",
]);

type GlobalSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

type GlobalSessionSummary = {
  id: string;
  state: GlobalSessionState;
  paused_at: string | null;
};

function parseSessionSummary(raw: unknown): GlobalSessionSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const state =
    typeof record.state === "string" && GLOBAL_SESSION_STATES.has(record.state)
      ? (record.state as GlobalSessionState)
      : null;
  const pausedAt = typeof record.paused_at === "string" ? record.paused_at : null;
  if (!id || !state) return null;
  return { id, state, paused_at: pausedAt };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type GlobalOrbitalCanvasProps = {
  onSelectProject?: (projectId: string) => void;
  selectedProjectId?: string | null;
};

const MAX_VOICE_CONTEXT_ITEMS = 12;

function toVoiceNode(node: ProjectNode): CanvasVoiceNode {
  return {
    id: node.id,
    type: "project",
    label: node.name,
    projectId: node.id,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GlobalOrbitalCanvas({
  onSelectProject,
  selectedProjectId = null,
}: GlobalOrbitalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vizRef = useRef<OrbitalGravityVisualization | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(null);
  const [globalSession, setGlobalSession] = useState<GlobalSessionSummary | null>(null);
  const lastFrame = useRef<number | null>(null);
  const selectedRef = useRef<VisualizationNode | null>(null);
  const hoveredRef = useRef<VisualizationNode | null>(null);
  const highlightedRef = useRef<ProjectNode | null>(null);
  const transformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });
  const sizeRef = useRef(canvasSize);

  // Data hook — fetches all projects, work orders, runs, global context, etc.
  const { data, loading, error, globalContext } = useProjectsVisualization();
  const initialDataRef = useRef(data);

  // The project nodes for interaction hit-testing come straight from data.nodes
  const projectNodes: ProjectNode[] = data.nodes;
  const highlightedNode = useMemo(
    () => projectNodes.find((node) => node.id === highlightedProjectId) ?? null,
    [projectNodes, highlightedProjectId]
  );
  const voiceVisibleProjects = useMemo<CanvasVoiceNode[]>(
    () => projectNodes.slice(0, MAX_VOICE_CONTEXT_ITEMS).map(toVoiceNode),
    [projectNodes]
  );
  const activeShiftProjects = useMemo<CanvasVoiceShift[]>(() => {
    const projects = globalContext?.projects ?? [];
    return projects
      .filter((project) => project.active_shift)
      .map((project) => ({
        projectId: project.id,
        projectName: project.name,
        startedAt: project.active_shift?.started_at ?? null,
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [globalContext]);
  const escalationSummaries = useMemo<CanvasVoiceEscalation[]>(() => {
    const projects = globalContext?.projects ?? [];
    const items = projects
      .filter((project) => project.escalations?.length)
      .map((project) => ({
        projectId: project.id,
        projectName: project.name,
        count: project.escalations.length,
        summary: project.escalations[0]?.summary ?? null,
      }));
    return items.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.projectName.localeCompare(b.projectName);
    });
  }, [globalContext]);

  // Canvas interaction (pan/zoom, hover, selection)
  const {
    transform,
    setTransform,
    selectNode,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    handlers,
  } = useCanvasInteraction({
    canvasRef,
    nodes: projectNodes,
  });
  const selectedProjectNode =
    selectedNode && selectedNode.type === "project" ? selectedNode : null;
  const voiceSelectedNode = useMemo<CanvasVoiceNode | null>(
    () => (selectedProjectNode ? toVoiceNode(selectedProjectNode) : null),
    [selectedProjectNode]
  );
  const globalSessionState = globalSession?.state ?? null;
  const globalSessionPaused = Boolean(globalSession?.paused_at);

  // -----------------------------------------------------------------------
  // Propagate selected project to parent
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (selectedNode && selectedNode.type === "project" && onSelectProject) {
      onSelectProject(selectedNode.id);
    }
  }, [selectedNode, onSelectProject]);

  // -----------------------------------------------------------------------
  // Global session polling for voice context
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const res = await fetch("/api/global/sessions/active", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) return;
        if (!json || typeof json !== "object" || !("session" in json)) {
          if (!cancelled) setGlobalSession(null);
          return;
        }
        const record = json as { session?: unknown };
        const parsed = parseSessionSummary(record.session ?? null);
        if (!cancelled) setGlobalSession(parsed);
      } catch {
        if (!cancelled) setGlobalSession(null);
      }
    };

    void loadSession();
    const interval = window.setInterval(loadSession, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Viz initialization
  // -----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const visualization = new OrbitalGravityVisualization({
      mode: "projects",
    });
    vizRef.current?.destroy();
    vizRef.current = visualization;
    visualization.init(canvas, initialDataRef.current);
    return () => {
      visualization.destroy();
      if (vizRef.current === visualization) {
        vizRef.current = null;
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Update data when it changes
  // -----------------------------------------------------------------------
  useEffect(() => {
    vizRef.current?.update(data);
  }, [data]);

  // -----------------------------------------------------------------------
  // Notify viz of hover/click state
  // -----------------------------------------------------------------------
  useEffect(() => {
    vizRef.current?.onNodeHover?.(hoveredNode ?? null);
  }, [hoveredNode]);

  useEffect(() => {
    vizRef.current?.onNodeClick?.(selectedNode ?? null);
  }, [selectedNode]);

  // -----------------------------------------------------------------------
  // Canvas sizing & DPR
  // -----------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      setCanvasSize({ width: rect.width, height: rect.height, dpr });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // -----------------------------------------------------------------------
  // Initial transform — center the canvas
  // -----------------------------------------------------------------------
  const initialTransformSet = useRef(false);
  useEffect(() => {
    if (initialTransformSet.current) return;
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    initialTransformSet.current = true;
    setTransform((prev) => ({
      ...prev,
      offsetX: canvasSize.width / 2,
      offsetY: canvasSize.height / 2,
    }));
  }, [canvasSize.height, canvasSize.width, setTransform]);

  // -----------------------------------------------------------------------
  // Sync refs for RAF render loop
  // -----------------------------------------------------------------------
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    selectedRef.current = selectedNode;
  }, [selectedNode]);

  useEffect(() => {
    hoveredRef.current = hoveredNode;
  }, [hoveredNode]);

  useEffect(() => {
    highlightedRef.current = highlightedNode;
  }, [highlightedNode]);

  useEffect(() => {
    sizeRef.current = canvasSize;
  }, [canvasSize]);

  useEffect(() => {
    setCanvasVoiceState({
      contextLabel: "Portfolio canvas",
      focusedNode: voiceSelectedNode,
      selectedNode: voiceSelectedNode,
      visibleProjects: voiceVisibleProjects,
      detailPanelOpen: Boolean(selectedProjectId),
      globalSessionState,
      globalSessionPaused,
      activeShiftProjects,
      escalationSummaries,
    });
  }, [
    activeShiftProjects,
    escalationSummaries,
    globalSessionPaused,
    globalSessionState,
    selectedProjectId,
    voiceSelectedNode,
    voiceVisibleProjects,
  ]);

  // -----------------------------------------------------------------------
  // RAF render loop
  // -----------------------------------------------------------------------
  useEffect(() => {
    const render = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#0b0d12";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const dpr = sizeRef.current.dpr || 1;
        const currentTransform = transformRef.current;
        ctx.save();
        ctx.setTransform(
          currentTransform.scale * dpr,
          0,
          0,
          currentTransform.scale * dpr,
          currentTransform.offsetX * dpr,
          currentTransform.offsetY * dpr
        );

        // Render the orbital visualization
        vizRef.current?.render();

        // Selected node highlight ring
        const selected = selectedRef.current;
        if (selected && selected.x !== undefined && selected.y !== undefined) {
          const radius = (selected.radius ?? 16) + 6;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(selected.x, selected.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Highlighted node ring
        const highlighted = highlightedRef.current;
        if (highlighted && highlighted.x !== undefined && highlighted.y !== undefined) {
          const radius = (highlighted.radius ?? 16) + 10;
          ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(highlighted.x, highlighted.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Hovered node highlight ring
        const hovered = hoveredRef.current;
        if (hovered && hovered.x !== undefined && hovered.y !== undefined) {
          const radius = (hovered.radius ?? 16) + 4;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(hovered.x, hovered.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }
      lastFrame.current = window.requestAnimationFrame(render);
    };

    lastFrame.current = window.requestAnimationFrame(render);
    return () => {
      if (lastFrame.current) {
        window.cancelAnimationFrame(lastFrame.current);
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Pointer down wrapper (no follow/manual mode needed at portfolio level)
  // -----------------------------------------------------------------------
  const handlePointerDown = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      handlers.onPointerDown(event);
    },
    [handlers]
  );

  // -----------------------------------------------------------------------
  // Zoom controls
  // -----------------------------------------------------------------------
  const zoomIn = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(prev.scale * 1.25, 2.8),
    }));
  }, [setTransform]);

  const zoomOut = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(prev.scale * 0.8, 0.4),
    }));
  }, [setTransform]);

  const resetZoom = useCallback(() => {
    setTransform((prev) => ({
      ...prev,
      scale: 1,
      offsetX: sizeRef.current.width / 2,
      offsetY: sizeRef.current.height / 2,
    }));
  }, [setTransform]);

  const focusProjectNode = useCallback(
    (projectId: string) => {
      const target = projectNodes.find((node) => node.id === projectId);
      if (!target || target.x === undefined || target.y === undefined) return false;
      const scale = transformRef.current.scale;
      const width = sizeRef.current.width || canvasSize.width;
      const height = sizeRef.current.height || canvasSize.height;
      setTransform((prev) => ({
        ...prev,
        offsetX: width / 2 - target.x * scale,
        offsetY: height / 2 - target.y * scale,
      }));
      return true;
    },
    [canvasSize.height, canvasSize.width, projectNodes, setTransform]
  );

  const openProjectDetail = useCallback(
    (projectId: string) => {
      const target = projectNodes.find((node) => node.id === projectId);
      if (!target) return false;
      if (selectedProjectNode?.id === target.id) {
        onSelectProject?.(target.id);
      } else {
        selectNode(target.id);
      }
      return true;
    },
    [onSelectProject, projectNodes, selectNode, selectedProjectNode]
  );

  useEffect(() => {
    return subscribeCanvasCommands((command) => {
      if (command.type === "focusProject") {
        focusProjectNode(command.projectId);
        return;
      }
      if (command.type === "highlightProject") {
        setHighlightedProjectId(command.projectId);
        return;
      }
      if (command.type === "openProjectDetail") {
        openProjectDetail(command.projectId);
      }
    });
  }, [focusProjectNode, openProjectDetail]);

  // -----------------------------------------------------------------------
  // Derive the hovered project node for the tooltip
  // -----------------------------------------------------------------------
  const hoveredProject: ProjectNode | null =
    hoveredNode?.type === "project" ? (hoveredNode as ProjectNode) : null;

  // -----------------------------------------------------------------------
  // Overlay content for loading / error states
  // -----------------------------------------------------------------------
  const overlayContent = (() => {
    if (error) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>Portfolio data unavailable</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {error}
          </div>
        </div>
      );
    }
    if (loading && projectNodes.length === 0) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>Loading portfolio canvas...</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Fetching project data across the portfolio.
          </div>
        </div>
      );
    }
    if (!loading && projectNodes.length === 0) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>No projects found</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Add a project to see it appear on the orbital canvas.
          </div>
        </div>
      );
    }
    return null;
  })();

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className={styles.canvasContainer} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={styles.canvasSurface}
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlers.onPointerMove}
        onPointerUp={handlers.onPointerUp}
        onPointerLeave={handlers.onPointerLeave}
        onWheel={handlers.onWheel}
      />

      {/* Tooltip for hovered project node */}
      {tooltipPosition && hoveredProject && (
        <div
          style={{
            position: "absolute",
            left: tooltipPosition.x + 12,
            top: tooltipPosition.y + 12,
            background: "rgba(15, 19, 32, 0.95)",
            border: "1px solid #22293a",
            borderRadius: 10,
            padding: "8px 10px",
            pointerEvents: "none",
            minWidth: 200,
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
            zIndex: 10,
          }}
        >
          <div style={{ fontWeight: 600 }}>{hoveredProject.name}</div>
          <div style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: healthColor(hoveredProject.health),
              }}
            />
            <span className="muted">{formatHealth(hoveredProject.health)}</span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Active WOs: {hoveredProject.workOrders.building + hoveredProject.workOrders.ready}
            {hoveredProject.workOrders.blocked > 0 && (
              <span style={{ color: "#f87171" }}> | {hoveredProject.workOrders.blocked} blocked</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Last activity: {formatActivity(hoveredProject.lastActivity)}
          </div>
          {hoveredProject.escalationCount > 0 && (
            <div style={{ fontSize: 12, marginTop: 4, color: "#fbbf24" }}>
              {hoveredProject.escalationCount} escalation{hoveredProject.escalationCount > 1 ? "s" : ""}
              {hoveredProject.escalationSummary && (
                <span className="muted"> &mdash; {hoveredProject.escalationSummary}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Overlay for loading / error / empty states */}
      {overlayContent}

      {/* Zoom controls */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 3,
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11 }}>
            {projectNodes.length} project{projectNodes.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            className="btnSecondary"
            style={{ fontSize: 14, padding: "4px 10px", fontWeight: 600 }}
            onClick={zoomIn}
            title="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="btnSecondary"
            style={{ fontSize: 14, padding: "4px 10px", fontWeight: 600 }}
            onClick={zoomOut}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="btnSecondary"
            style={{ fontSize: 11, padding: "4px 8px" }}
            onClick={resetZoom}
            title="Reset view"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

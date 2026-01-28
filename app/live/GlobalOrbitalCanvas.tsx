"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEventHandler,
} from "react";
import styles from "./live.module.css";
import { useCanvasInteraction } from "../playground/canvas/useCanvasInteraction";
import { OrbitalGravityVisualization } from "../playground/canvas/visualizations/OrbitalGravityViz";
import { useProjectsVisualization } from "../playground/canvas/useProjectsVisualization";
import { GlobalAgentActivityFeed } from "./GlobalAgentActivityFeed";
import type {
  ProjectNode,
  ProjectHealthStatus,
  VisualizationNode,
} from "../playground/canvas/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatActivity(value: Date | null): string {
  if (!value) return "No activity yet";
  return value.toLocaleString();
}

const HEALTH_LABELS: Record<ProjectHealthStatus, string> = {
  healthy: "Healthy",
  attention_needed: "Attention needed",
  stalled: "Stalled",
  failing: "Failing",
  blocked: "Blocked",
};

const HEALTH_COLORS: Record<ProjectHealthStatus, string> = {
  healthy: "#22c55e",
  attention_needed: "#fbbf24",
  stalled: "#f59e0b",
  failing: "#ef4444",
  blocked: "#f97316",
};

function resolveHealthStatus(
  status: ProjectHealthStatus | undefined,
  score: number
): ProjectHealthStatus {
  if (status) return status;
  if (score >= 0.8) return "healthy";
  if (score >= 0.55) return "stalled";
  if (score >= 0.45) return "attention_needed";
  if (score >= 0.3) return "failing";
  return "blocked";
}

function formatHealth(status: ProjectHealthStatus): string {
  return HEALTH_LABELS[status];
}

function healthColor(status: ProjectHealthStatus): string {
  return HEALTH_COLORS[status];
}

type PulseEvent = {
  id: string;
  projectId: string;
  startedAt: number;
  action?: string;
};

const PULSE_DURATION_MS = 2400;
const PULSE_EXPAND_RADIUS = 36;
const PULSE_COLORS: Record<string, string> = {
  DELEGATE: "#38bdf8",
  RESOLVE: "#22c55e",
  CREATE_PROJECT: "#2dd4bf",
  REPORT: "#cbd5f5",
  WAIT: "#94a3b8",
};

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const clamped = Math.max(0, Math.min(alpha, 1));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

function pulseColor(action?: string): string {
  if (!action) return PULSE_COLORS.DELEGATE;
  return PULSE_COLORS[action] ?? PULSE_COLORS.DELEGATE;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type GlobalOrbitalCanvasProps = {
  onSelectProject?: (projectId: string) => void;
  selectedProjectId?: string | null;
};

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
  const pulseEventsRef = useRef<PulseEvent[]>([]);
  const projectLookupRef = useRef<Map<string, ProjectNode>>(new Map());
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const lastFrame = useRef<number | null>(null);
  const selectedRef = useRef<VisualizationNode | null>(null);
  const hoveredRef = useRef<VisualizationNode | null>(null);
  const transformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });
  const sizeRef = useRef(canvasSize);
  const selectedProjectRef = useRef<string | null>(selectedProjectId ?? null);

  // Data hook — fetches all projects, work orders, runs, global context, etc.
  const { data, loading, error } = useProjectsVisualization();
  const initialDataRef = useRef(data);

  // The project nodes for interaction hit-testing come straight from data.nodes
  const projectNodes: ProjectNode[] = data.nodes;

  useEffect(() => {
    projectLookupRef.current = new Map(projectNodes.map((node) => [node.id, node]));
  }, [projectNodes]);

  // Canvas interaction (pan/zoom, hover, selection)
  const {
    transform,
    setTransform,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    clearSelection,
    selectNode,
    handlers,
  } = useCanvasInteraction({
    canvasRef,
    nodes: projectNodes,
  });

  // -----------------------------------------------------------------------
  // Propagate selected project to parent
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (selectedNode && selectedNode.type === "project" && onSelectProject) {
      onSelectProject(selectedNode.id);
    }
  }, [selectedNode, onSelectProject]);

  useEffect(() => {
    const previous = selectedProjectRef.current;
    selectedProjectRef.current = selectedProjectId ?? null;

    if (!selectedProjectId) {
      if (previous) {
        clearSelection();
      }
      return;
    }
    if (selectedNode?.id === selectedProjectId) return;
    selectNode(selectedProjectId);
  }, [clearSelection, selectNode, selectedProjectId, selectedNode]);

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
    sizeRef.current = canvasSize;
  }, [canvasSize]);

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

        const pulseNow = nowMs();
        if (pulseEventsRef.current.length > 0) {
          const nextPulses: PulseEvent[] = [];
          for (const pulse of pulseEventsRef.current) {
            const elapsed = pulseNow - pulse.startedAt;
            if (elapsed > PULSE_DURATION_MS) continue;
            const node = projectLookupRef.current.get(pulse.projectId);
            if (!node || node.x === undefined || node.y === undefined) {
              nextPulses.push(pulse);
              continue;
            }
            const progress = Math.min(1, elapsed / PULSE_DURATION_MS);
            const baseRadius = node.radius ?? 16;
            const radius = baseRadius + 8 + progress * PULSE_EXPAND_RADIUS;
            const opacity = (1 - progress) * 0.8;
            const color = pulseColor(pulse.action);
            ctx.save();
            ctx.strokeStyle = withAlpha(color, opacity);
            ctx.lineWidth = 2 + (1 - progress) * 1.4;
            ctx.shadowBlur = 14;
            ctx.shadowColor = withAlpha(color, opacity);
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            nextPulses.push(pulse);
          }
          pulseEventsRef.current = nextPulses;
        }

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

  const triggerProjectPulse = useCallback((projectId: string, action?: string) => {
    if (!projectId) return;
    const pulses = pulseEventsRef.current;
    pulses.push({
      id: `${projectId}-${Math.round(nowMs())}`,
      projectId,
      startedAt: nowMs(),
      action,
    });
    if (pulses.length > 60) {
      pulses.splice(0, pulses.length - 60);
    }
  }, []);

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

  // -----------------------------------------------------------------------
  // Derive the hovered project node for the tooltip
  // -----------------------------------------------------------------------
  const hoveredProject: ProjectNode | null =
    hoveredNode?.type === "project" ? (hoveredNode as ProjectNode) : null;
  const hoveredHealthStatus = hoveredProject
    ? resolveHealthStatus(hoveredProject.healthStatus, hoveredProject.health)
    : null;

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
          <div style={{ fontWeight: 600 }}>No projects yet</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Add a repo to see it appear on the orbital canvas.
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
                background: hoveredHealthStatus ? healthColor(hoveredHealthStatus) : "#94a3b8",
              }}
            />
            <span className="muted">
              {hoveredHealthStatus ? formatHealth(hoveredHealthStatus) : "Unknown"}
            </span>
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

      <GlobalAgentActivityFeed
        projectNodes={projectNodes}
        onProjectPulse={triggerProjectPulse}
      />

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

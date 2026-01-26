"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
} from "react";
import Link from "next/link";
import styles from "./live.module.css";
import { useCanvasInteraction } from "../playground/canvas/useCanvasInteraction";
import {
  OrbitalGravityVisualization,
  selectWorkOrderNodes,
  type WorkOrderFilter,
} from "../playground/canvas/visualizations/OrbitalGravityViz";
import type { AgentFocus } from "../playground/canvas/useAgentFocus";
import type {
  ProjectNode,
  RunSummary,
  VisualizationData,
  VisualizationNode,
  WorkOrderNode,
  WorkOrderStatus,
} from "../playground/canvas/types";
import {
  setCanvasVoiceState,
  subscribeCanvasCommands,
  type CanvasVoiceNode,
} from "../landing/components/VoiceWidget/voiceClientTools";

const IDLE_TIMEOUT_MS = 30000;
const FOCUS_CENTER_ATTEMPTS = 60;
const MAX_VOICE_CONTEXT_ITEMS = 16;

const FOCUS_RING_COLORS: Record<string, string> = {
  waiting_for_input: "#fbbf24",
  you_review: "#a855f7",
  ai_review: "#a855f7",
  testing: "#22d3ee",
  building: "#60a5fa",
  queued: "#60a5fa",
};

function resolveFocusRingColor(status?: string): string {
  if (!status) return "#f8fafc";
  return FOCUS_RING_COLORS[status] ?? "#f8fafc";
}

function formatRunStatus(value?: string): string {
  if (!value) return "idle";
  return value.replace(/_/g, " ");
}

function formatActivity(value: Date | null): string {
  if (!value) return "No activity yet";
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function toVoiceNode(node: VisualizationNode): CanvasVoiceNode {
  if (node.type === "work_order") {
    return {
      id: node.id,
      type: "work_order",
      label: node.workOrderId,
      title: node.title,
      projectId: node.projectId,
      workOrderId: node.workOrderId,
    };
  }
  return {
    id: node.id,
    type: "project",
    label: node.name,
    projectId: node.id,
  };
}

type WorkOrderDetails = {
  id: string;
  title: string;
  goal: string | null;
  status: WorkOrderStatus;
  priority: number;
  acceptance_criteria: string[];
};

type WorkOrderDetailsResponse = {
  work_order: WorkOrderDetails;
};

type LiveOrbitalCanvasProps = {
  data: VisualizationData;
  loading: boolean;
  error: string | null;
  project: ProjectNode | null;
  focus: AgentFocus | null;
};

type CanvasMode = "follow" | "manual";

export function LiveOrbitalCanvas({
  data,
  loading,
  error,
  project,
  focus,
}: LiveOrbitalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vizRef = useRef<OrbitalGravityVisualization | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [mode, setMode] = useState<CanvasMode>("follow");
  const [highlightedWorkOrderId, setHighlightedWorkOrderId] = useState<string | null>(null);
  const [showAllWOs, setShowAllWOs] = useState(false);
  const lastFrame = useRef<number | null>(null);
  const lastInteractionRef = useRef(Date.now());
  const focusRef = useRef<AgentFocus | null>(null);
  const focusNodeRef = useRef<WorkOrderNode | null>(null);
  const highlightedNodeRef = useRef<WorkOrderNode | null>(null);
  const selectedRef = useRef<VisualizationNode | null>(null);
  const hoveredRef = useRef<VisualizationNode | null>(null);
  const transformRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });
  const sizeRef = useRef(canvasSize);
  const initialDataRef = useRef(data);
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState<WorkOrderDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const projectId = project?.id ?? null;
  const hasActiveShift = Boolean(
    focus?.kind === "work_order" && focus.source === "active_run" && focus.workOrderId
  );

  const focusNodeId = useMemo(() => {
    if (!projectId || !focus || focus.kind !== "work_order" || !focus.workOrderId) {
      return null;
    }
    return `${projectId}::${focus.workOrderId}`;
  }, [focus, projectId]);

  const activeWorkOrderNodes = useMemo<WorkOrderNode[]>(() => {
    if (!data.workOrderNodes?.length) return [];
    return selectWorkOrderNodes({
      nodes: data.workOrderNodes,
      filter: "active",
      projectId,
    });
  }, [data.workOrderNodes, projectId]);

  const workOrderFilter = useMemo<WorkOrderFilter>(() => {
    // User override takes precedence
    if (showAllWOs) {
      return "all";
    }
    if (!hasActiveShift || activeWorkOrderNodes.length === 0) {
      return "all";
    }
    return "active";
  }, [activeWorkOrderNodes.length, hasActiveShift, showAllWOs]);

  const initialWorkOrderFilter = useRef<WorkOrderFilter>(workOrderFilter);

  const workOrderNodes = useMemo<WorkOrderNode[]>(() => {
    if (!data.workOrderNodes?.length) return [];
    return selectWorkOrderNodes({
      nodes: data.workOrderNodes,
      filter: workOrderFilter,
      projectId,
      includeIds: focusNodeId ? [focusNodeId] : undefined,
    });
  }, [data.workOrderNodes, focusNodeId, projectId, workOrderFilter]);

  const focusNode = useMemo(() => {
    if (!focusNodeId) return null;
    return workOrderNodes.find((node) => node.id === focusNodeId) ?? null;
  }, [focusNodeId, workOrderNodes]);

  const highlightedNode = useMemo(() => {
    if (!highlightedWorkOrderId) return null;
    return (
      workOrderNodes.find((node) => node.workOrderId === highlightedWorkOrderId) ??
      workOrderNodes.find((node) => node.id === highlightedWorkOrderId) ??
      null
    );
  }, [highlightedWorkOrderId, workOrderNodes]);

  const {
    transform,
    setTransform,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    clearSelection,
    handlers,
  } = useCanvasInteraction({
    canvasRef,
    nodes: workOrderNodes,
  });

  const selectedWorkOrderNode = selectedNode?.type === "work_order" ? selectedNode : null;

  const recentRuns = useMemo<RunSummary[]>(() => {
    if (!selectedWorkOrderNode) return [];
    const runs = data.runsByProject?.[selectedWorkOrderNode.projectId] ?? [];
    return runs
      .filter((run) => run.work_order_id === selectedWorkOrderNode.workOrderId)
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5);
  }, [data.runsByProject, selectedWorkOrderNode?.projectId, selectedWorkOrderNode?.workOrderId]);

  useEffect(() => {
    if (!selectedWorkOrderNode) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }

    let active = true;
    const loadDetails = async () => {
      setDetail(null);
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(
          `/api/repos/${encodeURIComponent(selectedWorkOrderNode.projectId)}/work-orders/${encodeURIComponent(
            selectedWorkOrderNode.workOrderId
          )}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => null)) as
          | WorkOrderDetailsResponse
          | { error?: string }
          | null;
        if (!res.ok) {
          throw new Error(
            (json as { error?: string } | null)?.error || "failed to load work order"
          );
        }
        if (active) {
          setDetail((json as WorkOrderDetailsResponse).work_order);
        }
      } catch (err) {
        if (active) {
          setDetailError(err instanceof Error ? err.message : "failed to load work order");
        }
      } finally {
        if (active) {
          setDetailLoading(false);
        }
      }
    };

    void loadDetails();
    return () => {
      active = false;
    };
  }, [selectedWorkOrderNode?.projectId, selectedWorkOrderNode?.workOrderId]);

  useEffect(() => {
    if (!selectedWorkOrderNode) return;
    const handlePointerDown = (event: PointerEvent) => {
      const panel = detailPanelRef.current;
      if (!panel) return;
      const target = event.target as Node | null;
      if (target && panel.contains(target)) return;
      clearSelection();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [clearSelection, selectedWorkOrderNode]);

  const registerUserInteraction = useCallback(() => {
    lastInteractionRef.current = Date.now();
    setMode((prev) => (prev === "manual" ? prev : "manual"));
  }, []);

  const resumeFollow = useCallback(() => {
    lastInteractionRef.current = Date.now();
    setMode("follow");
  }, []);

  const focusCanvasNode = useCallback(
    (nodeId: string) => {
      const trimmed = nodeId.trim();
      if (!trimmed) return;
      lastInteractionRef.current = Date.now();
      setMode("manual");
      let attempts = 0;
      const normalized = trimmed.toLowerCase();

      const resolveNode = () =>
        workOrderNodes.find((node) => node.id === trimmed) ??
        workOrderNodes.find((node) => node.workOrderId === trimmed) ??
        workOrderNodes.find((node) => node.id.toLowerCase() === normalized) ??
        workOrderNodes.find((node) => node.workOrderId.toLowerCase() === normalized) ??
        null;

      const attempt = () => {
        attempts += 1;
        const node = resolveNode();
        if (!node) return;
        const x = node.x;
        const y = node.y;
        if (
          x !== undefined &&
          y !== undefined &&
          canvasSize.width > 0 &&
          canvasSize.height > 0
        ) {
          setTransform((prev) => ({
            ...prev,
            offsetX: canvasSize.width / 2 - x * prev.scale,
            offsetY: canvasSize.height / 2 - y * prev.scale,
          }));
          return;
        }
        if (attempts < FOCUS_CENTER_ATTEMPTS) {
          window.requestAnimationFrame(attempt);
        }
      };

      window.requestAnimationFrame(attempt);
    },
    [canvasSize.height, canvasSize.width, setTransform, workOrderNodes]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const visualization = new OrbitalGravityVisualization({
      mode: "work-orders",
      filter: initialWorkOrderFilter.current,
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

  useEffect(() => {
    vizRef.current?.update(data);
  }, [data]);

  useEffect(() => {
    vizRef.current?.setProjectId?.(projectId ?? null);
  }, [projectId]);

  useEffect(() => {
    vizRef.current?.setWorkOrderFilter?.(workOrderFilter);
  }, [workOrderFilter]);

  useEffect(() => {
    vizRef.current?.setPinnedWorkOrderIds?.(focusNodeId ? [focusNodeId] : []);
  }, [focusNodeId]);

  useEffect(() => {
    vizRef.current?.onNodeHover?.(hoveredNode ?? null);
  }, [hoveredNode]);

  useEffect(() => {
    vizRef.current?.onNodeClick?.(selectedNode ?? null);
  }, [selectedNode]);

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
    focusRef.current = focus;
  }, [focus]);

  useEffect(() => {
    focusNodeRef.current = focusNode;
  }, [focusNode]);

  useEffect(() => {
    highlightedNodeRef.current = highlightedNode;
  }, [highlightedNode]);

  useEffect(() => {
    sizeRef.current = canvasSize;
  }, [canvasSize]);

  useEffect(() => {
    const visibleWorkOrders = workOrderNodes
      .slice(0, MAX_VOICE_CONTEXT_ITEMS)
      .map(toVoiceNode);
    const visibleProjects = project ? [toVoiceNode(project)] : [];

    setCanvasVoiceState({
      contextLabel: project ? `${project.name} live` : "Live canvas",
      focusedNode: focusNode ? toVoiceNode(focusNode) : null,
      selectedNode: selectedNode ? toVoiceNode(selectedNode) : null,
      visibleProjects,
      visibleWorkOrders,
      highlightedWorkOrderId: highlightedNode?.workOrderId ?? null,
      detailPanelOpen: Boolean(selectedWorkOrderNode),
    });
  }, [focusNode, highlightedNode, project, selectedNode, selectedWorkOrderNode, workOrderNodes]);

  useEffect(() => {
    if (mode !== "manual") return;
    const interval = window.setInterval(() => {
      if (Date.now() - lastInteractionRef.current >= IDLE_TIMEOUT_MS) {
        resumeFollow();
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [mode, resumeFollow]);

  useEffect(() => {
    if (mode !== "follow") return;
    if (!hasActiveShift || !focusNode) return;
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    let attempts = 0;
    let rafId = 0;

    const attemptCenter = () => {
      attempts += 1;
      if (focusNode.x !== undefined && focusNode.y !== undefined) {
        const { x, y } = focusNode;
        setTransform((prev) => ({
          ...prev,
          offsetX: canvasSize.width / 2 - x * prev.scale,
          offsetY: canvasSize.height / 2 - y * prev.scale,
        }));
        return;
      }
      if (attempts < FOCUS_CENTER_ATTEMPTS) {
        rafId = window.requestAnimationFrame(attemptCenter);
      }
    };

    rafId = window.requestAnimationFrame(attemptCenter);
    return () => window.cancelAnimationFrame(rafId);
  }, [canvasSize.height, canvasSize.width, focusNode, hasActiveShift, mode, setTransform]);

  useEffect(() => {
    return subscribeCanvasCommands((command) => {
      if (command.type === "focusNode") {
        focusCanvasNode(command.nodeId);
        return;
      }
      if (command.type === "highlightWorkOrder") {
        setHighlightedWorkOrderId(command.workOrderId);
        return;
      }
    });
  }, [focusCanvasNode]);

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
        vizRef.current?.render();

        const agentFocus = focusRef.current;
        const agentNode = focusNodeRef.current;
        const isActiveFocus =
          agentFocus?.kind === "work_order" && agentFocus.source === "active_run";
        if (
          isActiveFocus &&
          agentNode &&
          agentNode.x !== undefined &&
          agentNode.y !== undefined
        ) {
          const radius = (agentNode.radius ?? 16) + 8;
          const ringColor = resolveFocusRingColor(agentFocus.status);
          ctx.save();
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 2.2;
          ctx.shadowBlur = 18;
          ctx.shadowColor = ringColor;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(agentNode.x, agentNode.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        const highlighted = highlightedNodeRef.current;
        if (highlighted && highlighted.x !== undefined && highlighted.y !== undefined) {
          const radius = (highlighted.radius ?? 16) + 10;
          ctx.save();
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 2.4;
          ctx.shadowBlur = 20;
          ctx.shadowColor = "rgba(56, 189, 248, 0.8)";
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(highlighted.x, highlighted.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        const selected = selectedRef.current;
        if (selected && selected.x !== undefined && selected.y !== undefined) {
          const radius = (selected.radius ?? 16) + 6;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(selected.x, selected.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }

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

  const handlePointerDown = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      registerUserInteraction();
      handlers.onPointerDown(event);
    },
    [handlers, registerUserInteraction]
  );

  const zoomIn = useCallback(() => {
    registerUserInteraction();
    setTransform((prev) => ({
      ...prev,
      scale: Math.min(prev.scale * 1.25, 2.8),
    }));
  }, [registerUserInteraction, setTransform]);

  const zoomOut = useCallback(() => {
    registerUserInteraction();
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(prev.scale * 0.8, 0.4),
    }));
  }, [registerUserInteraction, setTransform]);

  const resetZoom = useCallback(() => {
    registerUserInteraction();
    setTransform((prev) => ({
      ...prev,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }));
  }, [registerUserInteraction, setTransform]);

  const overlayContent = (() => {
    if (error) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>Live data unavailable</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {error}
          </div>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>Loading live canvas...</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Waiting for project data and shift context.
          </div>
        </div>
      );
    }
    if (!project) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>No project data yet</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Start the local server to load live project state.
          </div>
        </div>
      );
    }
    if (!hasActiveShift) {
      return (
        <div className={styles.overlayCard}>
          <div style={{ fontWeight: 600 }}>No active shift right now</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Explore the project structure while the next shift spins up.
          </div>
          <div style={{ marginTop: 10 }}>
            <Link href={`/projects/${encodeURIComponent(project.id)}`} className="btnSecondary">
              Explore {project.name}
            </Link>
          </div>
        </div>
      );
    }
    return null;
  })();

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
      />

      {tooltipPosition && hoveredNode && hoveredNode.type === "work_order" && (
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
            minWidth: 180,
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div style={{ fontWeight: 600 }}>{hoveredNode.workOrderId}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {hoveredNode.title}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Status {formatRunStatus(hoveredNode.status)} | Priority P{hoveredNode.priority}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Activity {formatPercent(hoveredNode.activityLevel)} | Last{" "}
            {formatActivity(hoveredNode.lastActivity)}
          </div>
        </div>
      )}

      {selectedWorkOrderNode && (
        <aside ref={detailPanelRef} className={`card ${styles.detailPanel}`}>
          <div className={styles.detailHeader}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                {detail?.id ?? selectedWorkOrderNode.workOrderId}
              </div>
              <div className={styles.detailTitle}>
                {detail?.title ?? selectedWorkOrderNode.title}
              </div>
            </div>
            <button
              className="btnSecondary"
              onClick={clearSelection}
              style={{ padding: "4px 8px", fontSize: 12 }}
              aria-label="Close work order details"
            >
              X
            </button>
          </div>

          <div className={styles.detailMeta}>
            <span className="badge">
              {formatRunStatus(detail?.status ?? selectedWorkOrderNode.status)}
            </span>
            <span className="badge">P{detail?.priority ?? selectedWorkOrderNode.priority}</span>
          </div>

          {detailLoading && (
            <div className="muted" style={{ fontSize: 12 }}>
              Loading work order details...
            </div>
          )}
          {detailError && (
            <div className="error" style={{ fontSize: 12 }}>
              {detailError}
            </div>
          )}

          <div className={styles.detailSection}>
            <div className={styles.detailLabel}>Goal</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {detail?.goal?.trim()
                ? detail.goal
                : detailLoading
                  ? "Loading goal..."
                  : "No goal recorded."}
            </div>
          </div>

          <div className={styles.detailSection}>
            <div className={styles.detailLabel}>Acceptance criteria</div>
            {detail?.acceptance_criteria?.length ? (
              <ul className={styles.detailList}>
                {detail.acceptance_criteria.map((item, index) => (
                  <li key={`${selectedWorkOrderNode.workOrderId}-criteria-${index}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                {detailLoading ? "Loading acceptance criteria..." : "No acceptance criteria listed."}
              </div>
            )}
          </div>

          <div className={styles.detailSection}>
            <div className={styles.detailLabel}>Recent runs</div>
            {recentRuns.length ? (
              <div className={styles.runList}>
                {recentRuns.map((run) => (
                  <div key={run.id} className={styles.runItem}>
                    <span className={styles.runId}>{run.id}</span>
                    <span className="badge">{formatRunStatus(run.status)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                No recent runs yet.
              </div>
            )}
          </div>
        </aside>
      )}

      {overlayContent}

      {/* Canvas controls */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 5,
        }}
      >
        {/* Filter toggle */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            className={showAllWOs ? "btn" : "btnSecondary"}
            style={{ fontSize: 12, padding: "4px 10px" }}
            onClick={() => setShowAllWOs((prev) => !prev)}
            title={showAllWOs ? "Showing all WOs" : "Showing active WOs only"}
          >
            {showAllWOs ? "All WOs" : "Active only"}
          </button>
          <span className="muted" style={{ fontSize: 11 }}>
            {workOrderNodes.length} visible
          </span>
        </div>

        {/* Zoom controls */}
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

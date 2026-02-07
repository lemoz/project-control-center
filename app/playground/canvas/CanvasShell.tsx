"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
  type WheelEventHandler,
} from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ProjectNode, Visualization, VisualizationNode, WorkOrderNode } from "./types";
import { EscalationBadge } from "./EscalationBadge";
import { ProjectPopup } from "./ProjectPopup";
import { WorkOrderPopup } from "./WorkOrderPopup";
import { useProjectsVisualization } from "./useProjectsVisualization";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { useAgentFocusSync, type AgentFocus } from "./useAgentFocus";
import { defaultVisualizationId, findVisualization, visualizations } from "./visualizations";
import type { RiverBubbleDetails } from "./visualizations/TimelineRiverViz";
import type { HeatmapGrouping } from "./visualizations/HeatmapGridViz";
import { selectWorkOrderNodes, type WorkOrderFilter } from "./visualizations/OrbitalGravityViz";
import {
  setCanvasVoiceState,
  subscribeCanvasCommands,
  type CanvasVoiceNode,
} from "../../landing/components/VoiceWidget/voiceClientTools";

const TOOLTIP_OFFSET = 14;
const CLICK_THRESHOLD = 4;
const IDLE_TIMEOUT_MS = 30000;
const FOCUS_CENTER_ATTEMPTS = 60;
const MAX_VOICE_CONTEXT_ITEMS = 16;

type CanvasMode = "follow" | "manual";

const FOCUS_RING_COLORS: Record<string, string> = {
  waiting_for_input: "#fbbf24",
  security_hold: "#f97316",
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

type BubbleHitTestVisualization = Visualization & {
  getBubbleAtPoint: (point: { x: number; y: number }) => RiverBubbleDetails | null;
  setSelectedBubbleId?: (id: string | null) => void;
};

function supportsBubbleHitTest(
  visualization: Visualization | null
): visualization is BubbleHitTestVisualization {
  return Boolean(visualization && "getBubbleAtPoint" in visualization);
}

type LayoutConfigurableVisualization = Visualization & {
  setLayoutOptions?: (options: { grouping: HeatmapGrouping }) => void;
};

function supportsLayoutOptions(
  visualization: Visualization | null
): visualization is LayoutConfigurableVisualization {
  return Boolean(visualization && "setLayoutOptions" in visualization);
}

type WorkOrderFilterVisualization = Visualization & {
  setWorkOrderFilter?: (filter: WorkOrderFilter) => void;
  setProjectId?: (projectId: string | null) => void;
  setPinnedWorkOrderIds?: (ids: string[]) => void;
};

function supportsWorkOrderFilter(
  visualization: Visualization | null
): visualization is WorkOrderFilterVisualization {
  return Boolean(visualization && "setWorkOrderFilter" in visualization);
}

function isWorkOrderNode(node: VisualizationNode | null): node is WorkOrderNode {
  return Boolean(node && node.type === "work_order");
}

function isProjectNode(node: VisualizationNode | null): node is ProjectNode {
  return Boolean(node && node.type === "project");
}

function getCanvasPoint(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToWorld(
  point: { x: number; y: number },
  transform: { offsetX: number; offsetY: number; scale: number }
) {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

function findNodeAtPoint(
  nodes: VisualizationNode[],
  worldPoint: { x: number; y: number }
): VisualizationNode | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (node.x === undefined || node.y === undefined) continue;
    const radius = node.radius ?? 16;
    const dx = worldPoint.x - node.x;
    const dy = worldPoint.y - node.y;
    if (dx * dx + dy * dy <= radius * radius) return node;
  }
  return null;
}

function formatRunStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function formatRunTimestamp(value: string | null | undefined): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "N/A" : date.toLocaleString();
}

function formatTimestamp(value: Date | null): string {
  if (!value) return "never";
  return value.toLocaleTimeString();
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

function FocusModeChip({
  mode,
  focus,
  onResume,
}: {
  mode: CanvasMode;
  focus: AgentFocus | null;
  onResume: () => void;
}) {
  const isIdle = !focus || focus.kind === "none" || !focus.workOrderId;
  const focusLabel = isIdle ? "Agent idle" : focus.workOrderId;
  const statusLabel = !isIdle && focus?.status ? formatRunStatus(focus.status) : null;
  const modeLabel = mode === "follow" ? "Following agent" : "Manual";

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 12,
        background: "rgba(12, 15, 24, 0.9)",
        border: "1px solid #1d2233",
        color: "#e2e8f0",
        fontSize: 12,
        zIndex: 4,
      }}
    >
      <span style={{ fontWeight: 600 }}>{modeLabel}</span>
      <span className="badge" style={{ fontSize: 11 }}>{focusLabel}</span>
      {statusLabel && (
        <span className="badge" style={{ fontSize: 11 }}>
          {statusLabel}
        </span>
      )}
      {mode === "manual" && (
        <button
          className="btnSecondary"
          onClick={onResume}
          style={{ padding: "4px 8px", fontSize: 11 }}
        >
          Resume following
        </button>
      )}
    </div>
  );
}

export function CanvasShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vizRef = useRef<Visualization | null>(null);
  const searchParams = useSearchParams();
  const [selectedVizId, setSelectedVizId] = useState(defaultVisualizationId);
  const [selectedRun, setSelectedRun] = useState<RiverBubbleDetails | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [heatmapGrouping, setHeatmapGrouping] = useState<HeatmapGrouping>("status");
  const [workOrderFilter, setWorkOrderFilter] = useState<WorkOrderFilter>("active");
  const [mode, setMode] = useState<CanvasMode>("follow");
  const [detailPanelOpen, setDetailPanelOpen] = useState(true);
  const [highlightedWorkOrderId, setHighlightedWorkOrderId] = useState<string | null>(null);
  const lastFrame = useRef<number | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());
  const focusRef = useRef<AgentFocus | null>(null);
  const focusNodeRef = useRef<WorkOrderNode | null>(null);
  const highlightedNodeRef = useRef<WorkOrderNode | null>(null);

  const { data, loading, error, refresh, lastUpdated } = useProjectsVisualization();
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const projectParam = searchParams.get("project") ?? searchParams.get("projectId");
  const resolvedProjectId = useMemo(() => {
    if (!data.nodes.length) return null;
    if (projectParam) {
      const match = data.nodes.find((node) => node.id === projectParam);
      if (match) return match.id;
    }
    const activeProject = data.nodes.find((node) => node.isActive);
    return activeProject?.id ?? data.nodes[0]?.id ?? null;
  }, [data.nodes, projectParam]);

  const focus = useAgentFocusSync(resolvedProjectId, {
    intervalMs: 5000,
    hiddenIntervalMs: 15000,
    debounceMs: 400,
  });

  const focusNodeId = useMemo(() => {
    if (selectedVizId !== "orbital_work_orders") return null;
    if (!focus || focus.kind !== "work_order" || !resolvedProjectId || !focus.workOrderId) {
      return null;
    }
    return `${resolvedProjectId}::${focus.workOrderId}`;
  }, [focus, resolvedProjectId, selectedVizId]);

  const orbitalWorkOrderNodes = useMemo<WorkOrderNode[]>(() => {
    if (!data.workOrderNodes || data.workOrderNodes.length === 0) return [];
    return selectWorkOrderNodes({
      nodes: data.workOrderNodes,
      filter: workOrderFilter,
      projectId: resolvedProjectId,
      includeIds: focusNodeId ? [focusNodeId] : undefined,
    });
  }, [data.workOrderNodes, focusNodeId, resolvedProjectId, workOrderFilter]);

  const interactionNodes = useMemo<VisualizationNode[]>(() => {
    if (selectedVizId === "orbital_work_orders") {
      return orbitalWorkOrderNodes;
    }
    if (selectedVizId !== "heatmap_grid") return data.nodes;
    if (data.workOrderNodes && data.workOrderNodes.length > 0) {
      return data.workOrderNodes;
    }
    return data.nodes;
  }, [data.nodes, data.workOrderNodes, orbitalWorkOrderNodes, selectedVizId]);

  const combinedNodes = useMemo<VisualizationNode[]>(() => {
    if (!data.workOrderNodes?.length) return data.nodes;
    return [...data.nodes, ...data.workOrderNodes];
  }, [data.nodes, data.workOrderNodes]);

  const nodeDragEnabled = selectedVizId === "force_graph";

  const focusNode = useMemo(() => {
    if (!focusNodeId) return null;
    return orbitalWorkOrderNodes.find((node) => node.id === focusNodeId) ?? null;
  }, [focusNodeId, orbitalWorkOrderNodes]);

  const highlightedNode = useMemo(() => {
    if (!highlightedWorkOrderId) return null;
    const match = interactionNodes.find((node) => node.id === highlightedWorkOrderId);
    return match && match.type === "work_order" ? match : null;
  }, [highlightedWorkOrderId, interactionNodes]);

  const {
    transform,
    setTransform,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    handlers,
  } = useCanvasInteraction({
    canvasRef,
    nodes: nodeDragEnabled ? combinedNodes : interactionNodes,
    onNodeDragStart: nodeDragEnabled
      ? (node, point) => vizRef.current?.onNodeDragStart?.(node, point)
      : undefined,
    onNodeDrag: nodeDragEnabled
      ? (node, point) => vizRef.current?.onNodeDrag?.(node, point)
      : undefined,
    onNodeDragEnd: nodeDragEnabled
      ? (node) => vizRef.current?.onNodeDragEnd?.(node)
      : undefined,
  });
  const transformRef = useRef(transform);
  const selectedRef = useRef(selectedNode);
  const hoveredRef = useRef(hoveredNode);
  const sizeRef = useRef(canvasSize);

  const selectedSummary = useMemo(() => {
    if (!selectedNode) return "None";
    if (isWorkOrderNode(selectedNode)) {
      return `${selectedNode.workOrderId} · ${selectedNode.title}`;
    }
    return selectedNode.name;
  }, [selectedNode]);

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
      setMode("manual");
      let attempts = 0;
      const normalized = trimmed.toLowerCase();
      const matchesNormalized = (value?: string | null) =>
        typeof value === "string" && value.toLowerCase() === normalized;

      const resolveNode = () =>
        combinedNodes.find((item) => item.id === trimmed) ??
        combinedNodes.find(
          (item) => item.type === "work_order" && item.workOrderId === trimmed
        ) ??
        combinedNodes.find((item) => matchesNormalized(item.id)) ??
        combinedNodes.find(
          (item) => item.type === "work_order" && matchesNormalized(item.workOrderId)
        ) ??
        combinedNodes.find(
          (item) => item.type === "project" && matchesNormalized(item.name)
        ) ??
        combinedNodes.find(
          (item) => item.type === "project" && matchesNormalized(item.label)
        ) ??
        null;

      const attempt = () => {
        attempts += 1;
        const node = resolveNode();
        if (!node) return;
        if (
          node.x !== undefined &&
          node.y !== undefined &&
          canvasSize.width > 0 &&
          canvasSize.height > 0
        ) {
          const nodeX = node.x;
          const nodeY = node.y;
          setTransform((prev) => ({
            ...prev,
            offsetX: canvasSize.width / 2 - nodeX * prev.scale,
            offsetY: canvasSize.height / 2 - nodeY * prev.scale,
          }));
          return;
        }
        if (attempts < FOCUS_CENTER_ATTEMPTS) {
          window.requestAnimationFrame(attempt);
        }
      };

      window.requestAnimationFrame(attempt);
    },
    [canvasSize.height, canvasSize.width, combinedNodes, setTransform]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const definition = findVisualization(selectedVizId);
    const visualization = definition.create();
    vizRef.current?.destroy();
    vizRef.current = visualization;
    visualization.init(canvas, dataRef.current);
    return () => {
      visualization.destroy();
      if (vizRef.current === visualization) {
        vizRef.current = null;
      }
    };
  }, [selectedVizId]);

  useEffect(() => {
    setSelectedRun(null);
    const visualization = vizRef.current;
    if (supportsBubbleHitTest(visualization)) {
      visualization.setSelectedBubbleId?.(null);
    }
  }, [selectedVizId]);

  useEffect(() => {
    const visualization = vizRef.current;
    if (!supportsLayoutOptions(visualization)) return;
    visualization.setLayoutOptions?.({ grouping: heatmapGrouping });
  }, [heatmapGrouping, selectedVizId]);

  useEffect(() => {
    if (selectedVizId !== "orbital_work_orders") return;
    const visualization = vizRef.current;
    if (!supportsWorkOrderFilter(visualization)) return;
    visualization.setWorkOrderFilter?.(workOrderFilter);
    visualization.setProjectId?.(resolvedProjectId ?? null);
  }, [selectedVizId, workOrderFilter, resolvedProjectId]);

  useEffect(() => {
    if (selectedVizId !== "orbital_work_orders") return;
    const visualization = vizRef.current;
    if (!supportsWorkOrderFilter(visualization)) return;
    visualization.setPinnedWorkOrderIds?.(focusNodeId ? [focusNodeId] : []);
  }, [focusNodeId, selectedVizId]);

  useEffect(() => {
    vizRef.current?.update(data);
  }, [data]);

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
    vizRef.current?.onNodeHover?.(hoveredNode);
  }, [hoveredNode]);

  useEffect(() => {
    sizeRef.current = canvasSize;
  }, [canvasSize]);

  useEffect(() => {
    const visibleProjects = interactionNodes
      .filter((node) => node.type === "project")
      .slice(0, MAX_VOICE_CONTEXT_ITEMS)
      .map(toVoiceNode);
    const visibleWorkOrders = interactionNodes
      .filter((node) => node.type === "work_order")
      .slice(0, MAX_VOICE_CONTEXT_ITEMS)
      .map(toVoiceNode);

    setCanvasVoiceState({
      contextLabel: "Canvas",
      focusedNode: focusNode ? toVoiceNode(focusNode) : null,
      selectedNode: selectedNode ? toVoiceNode(selectedNode) : null,
      visibleProjects,
      visibleWorkOrders,
      highlightedWorkOrderId,
      detailPanelOpen,
    });
  }, [
    detailPanelOpen,
    focusNode,
    highlightedWorkOrderId,
    interactionNodes,
    selectedNode,
  ]);

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
    if (!focusNode) return;
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
  }, [canvasSize.height, canvasSize.width, focusNode, mode, setTransform]);

  useEffect(() => {
    return subscribeCanvasCommands((command) => {
      if (command.type === "focusNode") {
        focusCanvasNode(command.nodeId);
        return;
      }
      if (command.type === "highlightWorkOrder") {
        const resolvedId =
          data.workOrderNodes?.find((node) => node.workOrderId === command.workOrderId)?.id ??
          null;
        setHighlightedWorkOrderId(resolvedId);
        return;
      }
      if (command.type === "toggleDetailPanel") {
        setDetailPanelOpen(command.open);
      }
    });
  }, [data.workOrderNodes, focusCanvasNode]);

  const handlePointerDown = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      registerUserInteraction();
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
      handlers.onPointerDown(event);
    },
    [handlers, registerUserInteraction]
  );

  const handlePointerUp = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      handlers.onPointerUp(event);
      const start = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!start) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance > CLICK_THRESHOLD) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const point = getCanvasPoint(event, canvas);
      const worldPoint = screenToWorld(point, transform);
      const visualization = vizRef.current;
      if (supportsBubbleHitTest(visualization)) {
        const bubble = visualization.getBubbleAtPoint(worldPoint);
        if (bubble) {
          setSelectedRun(bubble);
          visualization.setSelectedBubbleId?.(bubble.bubbleId);
          return;
        }
        visualization.setSelectedBubbleId?.(null);
      }
      const clickedNode = findNodeAtPoint(
        nodeDragEnabled ? combinedNodes : interactionNodes,
        worldPoint
      );
      vizRef.current?.onNodeClick?.(clickedNode ?? null);
      setSelectedRun(null);
    },
    [combinedNodes, handlers, interactionNodes, nodeDragEnabled, transform]
  );

  const handlePointerLeave = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      pointerDownRef.current = null;
      handlers.onPointerLeave(event);
    },
    [handlers]
  );

  const handleWheel = useCallback<WheelEventHandler<HTMLCanvasElement>>(
    (event) => {
      registerUserInteraction();
      handlers.onWheel(event);
    },
    [handlers, registerUserInteraction]
  );

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
        if (
          agentNode &&
          agentFocus?.kind === "work_order" &&
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

  return (
    <main style={{
      display: "flex",
      flexDirection: "column",
      gap: 12,
      ...(isFullscreen ? {
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "#0a0c12",
        padding: 0,
        gap: 0,
      } : {}),
    }}>
      <section
        className={isFullscreen ? "" : "card"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          ...(isFullscreen ? {
            padding: "8px 16px",
            borderBottom: "1px solid #1d2233",
            background: "rgba(10, 12, 18, 0.95)",
          } : {}),
        }}
      >
        {!isFullscreen && (
          <Link href="/" className="badge">
            &larr; Portfolio
          </Link>
        )}
        <div>
          <h2 style={{ margin: 0, fontSize: isFullscreen ? 16 : undefined }}>Canvas Playground</h2>
          {!isFullscreen && (
            <div className="muted" style={{ fontSize: 13 }}>
              Ambient canvas shell for spatial project experiments.
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="select"
            value={selectedVizId}
            onChange={(event) => setSelectedVizId(event.target.value)}
          >
            {visualizations.map((viz) => (
              <option key={viz.id} value={viz.id}>
                {viz.name}
              </option>
            ))}
          </select>
          {selectedVizId === "orbital_work_orders" && (
            <button
              className="btnSecondary"
              onClick={() =>
                setWorkOrderFilter((prev) => (prev === "active" ? "all" : "active"))
              }
              title={
                workOrderFilter === "active"
                  ? "Show backlog and archive work orders"
                  : "Show active, ready, and blocked work orders"
              }
            >
              {workOrderFilter === "active" ? "Show all WOs" : "Show active only"}
            </button>
          )}
          <button className="btnSecondary" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <button
            className="btnSecondary"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? "✕" : "⛶"}
          </button>
        </div>
      </section>

      <section
        className={isFullscreen ? "" : "card"}
        style={{
          position: "relative",
          minHeight: isFullscreen ? undefined : 520,
          padding: 0,
          ...(isFullscreen ? { flex: 1 } : {}),
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            height: isFullscreen ? "100%" : 520,
            overflow: "hidden",
            borderRadius: isFullscreen ? 0 : 12,
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              cursor: isPanning ? "grabbing" : "grab",
              touchAction: "none",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onWheel={handleWheel}
          />

          {selectedVizId === "orbital_work_orders" && (
            <FocusModeChip mode={mode} focus={focus} onResume={resumeFollow} />
          )}

          {hoveredNode && tooltipPosition && (
            <div
              style={{
                position: "absolute",
                left: tooltipPosition.x + TOOLTIP_OFFSET,
                top: tooltipPosition.y + TOOLTIP_OFFSET,
                background: "rgba(15, 19, 32, 0.95)",
                border: "1px solid #22293a",
                borderRadius: 10,
                padding: "8px 10px",
                pointerEvents: "none",
                minWidth: 180,
                boxShadow: "0 8px 20px rgba(0, 0, 0, 0.35)",
              }}
            >
              {isWorkOrderNode(hoveredNode) ? (
                <>
                  <div style={{ fontWeight: 600 }}>{hoveredNode.workOrderId}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {hoveredNode.title}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Status {formatRunStatus(hoveredNode.status)} | Priority P{hoveredNode.priority}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Project {hoveredNode.projectName} | Era {hoveredNode.era ?? "Unassigned"}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Activity {formatPercent(hoveredNode.activityLevel)} | Last{" "}
                    {formatActivity(hoveredNode.lastActivity)}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 600 }}>{hoveredNode.name}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Status {hoveredNode.status} | Consumption {hoveredNode.consumptionRate} t/day
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Activity {formatPercent(hoveredNode.activityLevel)} | Health{" "}
                    {formatPercent(hoveredNode.health)}
                  </div>
                  {hoveredNode.escalationCount > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <EscalationBadge count={hoveredNode.escalationCount} compact />
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {detailPanelOpen && selectedNode && !selectedRun && isProjectNode(selectedNode) && (
            <ProjectPopup node={selectedNode} />
          )}
          {detailPanelOpen && selectedNode && !selectedRun && isWorkOrderNode(selectedNode) && (
            <WorkOrderPopup node={selectedNode} />
          )}

          {selectedRun && (
            <aside
              style={{
                position: "absolute",
                left: 16,
                bottom: 16,
                width: 280,
                background: "rgba(10, 12, 18, 0.96)",
                border: "1px solid #1d2233",
                borderRadius: 14,
                padding: 12,
                boxShadow: "0 16px 32px rgba(0, 0, 0, 0.45)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Run {selectedRun.runId}</div>
                <div
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    border: "1px solid #2b3347",
                    background: "#141824",
                  }}
                >
                  {formatRunStatus(selectedRun.status)}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {selectedRun.projectName} · {selectedRun.stageLabel}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Work Order: {selectedRun.workOrderId}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Created: {formatRunTimestamp(selectedRun.createdAt)}
              </div>
              {selectedRun.startedAt && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Started: {formatRunTimestamp(selectedRun.startedAt)}
                </div>
              )}
              {selectedRun.finishedAt && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Finished: {formatRunTimestamp(selectedRun.finishedAt)}
                </div>
              )}
              {selectedRun.escalation && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    borderRadius: 10,
                    background: "rgba(52, 17, 24, 0.5)",
                    border: "1px solid #4b1620",
                    fontSize: 11,
                    color: "#ffb3b8",
                  }}
                >
                  {selectedRun.escalation}
                </div>
              )}
            </aside>
          )}

          {loading && (
            <div
              className="muted"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                background: "rgba(11, 13, 18, 0.6)",
              }}
            >
              Loading canvas data...
            </div>
          )}

          {!loading && !data.nodes.length && (
            <div
              className="muted"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
              }}
            >
              No projects yet. Start the server to load repos.
            </div>
          )}
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      {!isFullscreen && (
      <section className="card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Selected</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {selectedSummary}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 600 }}>Last update</div>
            <div className="muted" style={{ fontSize: 13 }}>
              {formatTimestamp(lastUpdated)}
            </div>
          </div>
        </div>
        {selectedNode && isProjectNode(selectedNode) && (
          <div className="muted" style={{ fontSize: 13 }}>
            Status {selectedNode.status} | Active {selectedNode.isActive ? "yes" : "no"} | Success{" "}
            {formatPercent(selectedNode.successProgress)}
          </div>
        )}
        {selectedNode && isProjectNode(selectedNode) && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <EscalationBadge count={selectedNode.escalationCount} />
            <div className="muted" style={{ fontSize: 12 }}>
              Last activity: {formatActivity(selectedNode.lastActivity)}
            </div>
          </div>
        )}
        {selectedNode && isWorkOrderNode(selectedNode) && (
          <div className="muted" style={{ fontSize: 13 }}>
            Status {formatRunStatus(selectedNode.status)} | Priority P{selectedNode.priority} | Project{" "}
            {selectedNode.projectName}
          </div>
        )}
        {selectedNode && isWorkOrderNode(selectedNode) && (
          <div className="muted" style={{ fontSize: 12 }}>
            Era {selectedNode.era ?? "Unassigned"} | Last activity:{" "}
            {formatActivity(selectedNode.lastActivity)}
          </div>
        )}
      </section>
      )}
    </main>
  );
}

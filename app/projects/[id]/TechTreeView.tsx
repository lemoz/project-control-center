"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, WheelEvent } from "react";
import Link from "next/link";

type WorkOrderStatus =
  | "backlog"
  | "ready"
  | "building"
  | "ai_review"
  | "you_review"
  | "done"
  | "blocked"
  | "parked";

type DependencyNode = {
  id: string;
  title: string;
  status: WorkOrderStatus;
  priority: number;
  era: string | null;
  dependsOn: string[];
  dependents: string[];
  trackId: string | null;
  track: { id: string; name: string; color: string | null } | null;
  projectId: string;
  projectName: string;
  isExternal: boolean;
};

type TechTreeResponse = {
  nodes: DependencyNode[];
  cycles: string[][];
  eras: string[];
};

const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  backlog: "#6b7280",
  ready: "#22c55e",
  building: "#f59e0b",
  ai_review: "#a855f7",
  you_review: "#3b82f6",
  done: "#10b981",
  blocked: "#ef4444",
  parked: "#78716c",
};

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  building: "Building",
  ai_review: "AI Review",
  you_review: "You Review",
  done: "Done",
  blocked: "Blocked",
  parked: "Parked",
};

const ERA_LANES = [
  { id: "v0", label: "v0", color: "#1f2937" },
  { id: "v1", label: "v1", color: "#0f766e" },
  { id: "v2", label: "v2", color: "#1d4ed8" },
] as const;
const ERA_LANE_IDS = new Set(ERA_LANES.map((lane) => lane.id));
const UNASSIGNED_ERA_ID = "unassigned";
const UNASSIGNED_ERA = { id: UNASSIGNED_ERA_ID, label: "Unassigned", color: "#475569" };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 100;
const ERA_COLUMN_WIDTH = NODE_WIDTH + HORIZONTAL_GAP;
const VERTICAL_GAP = 30;
const LANE_HEADER_HEIGHT = 32;
const LANE_PADDING_Y = 16;
const LANE_GAP = 24;
const LEFT_PADDING = 60;
const RIGHT_PADDING = 120;
const TOP_PADDING = 50;
const BOTTOM_PADDING = 50;
const UNASSIGNED_LANE_ID = "unassigned";
const MIN_SCALE = 0.1;
const MAX_SCALE = 2.5;
const SCALE_STEP = 1.15;
const FIT_PADDING = 0.94;
const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 160;

type LaneLayout = {
  id: string;
  name: string;
  color: string | null;
  nodes: DependencyNode[];
  isUnassigned: boolean;
  top: number;
  height: number;
  isCollapsed: boolean;
};

type EraLaneLayout = {
  id: string;
  label: string;
  color: string;
  x: number;
  width: number;
};

type Viewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function TechTreeView({ repoId, onClose }: { repoId: string; onClose?: () => void }) {
  const [data, setData] = useState<TechTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const [scale, setScale] = useState(1);
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, width: 0, height: 0 });
  const [isScaleReady, setIsScaleReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const zoomStorageKey = `pcc.techTree.zoom.${repoId}`;

  const toggleLane = useCallback((laneId: string) => {
    setCollapsedLanes((prev) => ({ ...prev, [laneId]: !prev[laneId] }));
  }, []);

  const clampScale = useCallback((value: number) => {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  }, []);

  const updateViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextScale = scaleRef.current;
    setViewport({
      x: container.scrollLeft / nextScale,
      y: container.scrollTop / nextScale,
      width: container.clientWidth / nextScale,
      height: container.clientHeight / nextScale,
    });
  }, []);

  const applyScale = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      const container = containerRef.current;
      const prevScale = scaleRef.current;
      const clamped = clampScale(nextScale);
      setScale(clamped);

      if (!container) return;

      const { scrollLeft, scrollTop, clientWidth, clientHeight } = container;
      const anchorX = anchor
        ? (scrollLeft + anchor.x) / prevScale
        : (scrollLeft + clientWidth / 2) / prevScale;
      const anchorY = anchor
        ? (scrollTop + anchor.y) / prevScale
        : (scrollTop + clientHeight / 2) / prevScale;

      requestAnimationFrame(() => {
        container.scrollLeft = Math.max(0, anchorX * clamped - (anchor ? anchor.x : clientWidth / 2));
        container.scrollTop = Math.max(0, anchorY * clamped - (anchor ? anchor.y : clientHeight / 2));
        updateViewport();
      });
    },
    [clampScale, updateViewport],
  );

  const zoomIn = useCallback(() => {
    applyScale(scaleRef.current * SCALE_STEP);
  }, [applyScale]);

  const zoomOut = useCallback(() => {
    applyScale(scaleRef.current / SCALE_STEP);
  }, [applyScale]);

  const resetZoom = useCallback(() => {
    applyScale(1);
  }, [applyScale]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(zoomStorageKey);
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
    if (Number.isFinite(parsed)) {
      setScale(clampScale(parsed));
    } else {
      setScale(1);
    }
    setIsScaleReady(true);
  }, [zoomStorageKey, clampScale]);

  useEffect(() => {
    if (!isScaleReady || typeof window === "undefined") return;
    window.sessionStorage.setItem(zoomStorageKey, scale.toFixed(3));
  }, [isScaleReady, scale, zoomStorageKey]);

  useEffect(() => {
    const handleResize = () => updateViewport();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateViewport]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetZoom, zoomIn, zoomOut]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${encodeURIComponent(repoId)}/tech-tree`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as TechTreeResponse | { error?: string } | null;
      if (!res.ok) {
        throw new Error((json as { error?: string } | null)?.error || "failed to load tech tree");
      }
      setData(json as TechTreeResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Calculate node positions based on era lanes + track lanes
  const { nodePositions, svgWidth, svgHeight, lanes, eraColumns } = useMemo(() => {
    if (!data)
      return {
        nodePositions: new Map<string, { x: number; y: number }>(),
        svgWidth: 800,
        svgHeight: 600,
        lanes: [] as LaneLayout[],
        eraColumns: [] as EraLaneLayout[],
      };

    const nodes = data.nodes;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const positions = new Map<string, { x: number; y: number }>();

    // Calculate depth for each node (max distance from a root)
    const depths = new Map<string, number>();

    function getDepth(id: string, visited: Set<string>): number {
      if (depths.has(id)) return depths.get(id)!;
      if (visited.has(id)) return 0; // cycle protection
      visited.add(id);

      const node = nodeMap.get(id);
      if (!node || node.dependsOn.length === 0) {
        depths.set(id, 0);
        return 0;
      }

      let maxParentDepth = 0;
      for (const depId of node.dependsOn) {
        if (nodeMap.has(depId)) {
          maxParentDepth = Math.max(maxParentDepth, getDepth(depId, visited) + 1);
        }
      }
      depths.set(id, maxParentDepth);
      return maxParentDepth;
    }

    for (const node of nodes) {
      getDepth(node.id, new Set());
    }

    const normalizeEra = (value: string | null) => {
      if (!value) return UNASSIGNED_ERA_ID;
      const trimmed = value.trim();
      return ERA_LANE_IDS.has(trimmed) ? trimmed : UNASSIGNED_ERA_ID;
    };

    const needsUnassigned = nodes.some((node) => normalizeEra(node.era) === UNASSIGNED_ERA_ID);
    const eraList = needsUnassigned ? [...ERA_LANES, UNASSIGNED_ERA] : [...ERA_LANES];
    const eraLayouts: EraLaneLayout[] = eraList.map((lane, index) => ({
      ...lane,
      x: LEFT_PADDING + index * ERA_COLUMN_WIDTH,
      width: ERA_COLUMN_WIDTH,
    }));
    const eraIndexById = new Map(eraLayouts.map((lane, index) => [lane.id, index]));

    const lanesById = new Map<string, { id: string; name: string; color: string | null; nodes: DependencyNode[]; isUnassigned: boolean }>();

    for (const node of nodes) {
      const trackId = node.track?.id ?? node.trackId ?? null;
      const isUnassigned = !trackId;
      const laneId = trackId ?? UNASSIGNED_LANE_ID;
      const laneName = isUnassigned ? "Unassigned" : node.track?.name ?? trackId ?? "Unknown track";
      const laneColor = isUnassigned ? "#334155" : node.track?.color ?? "#334155";

      const existing = lanesById.get(laneId);
      if (existing) {
        if (!existing.isUnassigned) {
          if (node.track?.name) existing.name = node.track.name;
          if (node.track?.color) existing.color = node.track.color;
        }
        existing.nodes.push(node);
      } else {
        lanesById.set(laneId, {
          id: laneId,
          name: laneName,
          color: laneColor,
          nodes: [node],
          isUnassigned,
        });
      }
    }

    const laneList = Array.from(lanesById.values()).sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    for (const lane of laneList) {
      lane.nodes.sort((a, b) => {
        const depthA = depths.get(a.id) ?? 0;
        const depthB = depths.get(b.id) ?? 0;
        if (depthA !== depthB) return depthA - depthB;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.title.localeCompare(b.title);
      });
    }

    let yOffset = TOP_PADDING;
    const laneLayouts: LaneLayout[] = [];

    for (const lane of laneList) {
      const isCollapsed = collapsedLanes[lane.id] ?? false;
      const visibleNodes = isCollapsed ? [] : lane.nodes;
      const nodeCount = visibleNodes.length;
      const nodesHeight =
        nodeCount === 0 ? 0 : nodeCount * NODE_HEIGHT + (nodeCount - 1) * VERTICAL_GAP;
      const laneHeight = isCollapsed
        ? LANE_HEADER_HEIGHT + LANE_PADDING_Y
        : LANE_HEADER_HEIGHT + LANE_PADDING_Y + nodesHeight + LANE_PADDING_Y;
      const laneTop = yOffset;

      laneLayouts.push({
        ...lane,
        top: laneTop,
        height: laneHeight,
        isCollapsed,
      });

      visibleNodes.forEach((node, idx) => {
        const eraId = normalizeEra(node.era);
        const eraIndex = eraIndexById.get(eraId) ?? 0;
        positions.set(node.id, {
          x: LEFT_PADDING + eraIndex * ERA_COLUMN_WIDTH,
          y: laneTop + LANE_HEADER_HEIGHT + LANE_PADDING_Y + idx * (NODE_HEIGHT + VERTICAL_GAP),
        });
      });

      yOffset += laneHeight + LANE_GAP;
    }

    const columnCount = Math.max(1, eraLayouts.length);
    const width =
      LEFT_PADDING + columnCount * ERA_COLUMN_WIDTH - HORIZONTAL_GAP + RIGHT_PADDING;
    const height = Math.max(400, yOffset - LANE_GAP + BOTTOM_PADDING);

    return {
      nodePositions: positions,
      svgWidth: Math.max(800, width),
      svgHeight: height,
      lanes: laneLayouts,
      eraColumns: eraLayouts,
    };
  }, [data, collapsedLanes]);

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scaleX = container.clientWidth / svgWidth;
    const scaleY = container.clientHeight / svgHeight;
    const nextScale = clampScale(Math.min(scaleX, scaleY) * FIT_PADDING);
    setScale(nextScale);

    requestAnimationFrame(() => {
      const scaledWidth = svgWidth * nextScale;
      const scaledHeight = svgHeight * nextScale;
      container.scrollLeft = Math.max(0, (scaledWidth - container.clientWidth) / 2);
      container.scrollTop = Math.max(0, (scaledHeight - container.clientHeight) / 2);
      updateViewport();
    });
  }, [clampScale, svgWidth, svgHeight, updateViewport]);

  useEffect(() => {
    updateViewport();
  }, [scale, svgWidth, svgHeight, updateViewport]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP;
      const rect = event.currentTarget.getBoundingClientRect();
      applyScale(scaleRef.current * factor, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [applyScale],
  );

  const handleMinimapClick = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      const targetX = (clickX / rect.width) * svgWidth;
      const targetY = (clickY / rect.height) * svgHeight;
      const nextScale = scaleRef.current;
      const maxScrollLeft = Math.max(0, svgWidth * nextScale - container.clientWidth);
      const maxScrollTop = Math.max(0, svgHeight * nextScale - container.clientHeight);
      const nextLeft = Math.min(
        maxScrollLeft,
        Math.max(0, targetX * nextScale - container.clientWidth / 2),
      );
      const nextTop = Math.min(
        maxScrollTop,
        Math.max(0, targetY * nextScale - container.clientHeight / 2),
      );
      container.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    },
    [svgWidth, svgHeight],
  );

  // Determine which nodes are in cycles
  const nodesInCycles = useMemo(() => {
    if (!data) return new Set<string>();
    const set = new Set<string>();
    for (const cycle of data.cycles) {
      for (const id of cycle) {
        set.add(id);
      }
    }
    return set;
  }, [data]);

  // Highlighted nodes based on selection/hover
  const { highlightedDeps, highlightedDependents } = useMemo(() => {
    const focusId = selectedId || hoveredId;
    if (!focusId || !data) {
      return { highlightedDeps: new Set<string>(), highlightedDependents: new Set<string>() };
    }
    const node = data.nodes.find((n) => n.id === focusId);
    if (!node) {
      return { highlightedDeps: new Set<string>(), highlightedDependents: new Set<string>() };
    }
    return {
      highlightedDeps: new Set(node.dependsOn),
      highlightedDependents: new Set(node.dependents),
    };
  }, [data, selectedId, hoveredId]);

  const focusId = selectedId || hoveredId;
  const selectedNode = data?.nodes.find((n) => n.id === selectedId) ?? null;
  const nodeIndex = useMemo(() => {
    if (!data) return new Map<string, DependencyNode>();
    return new Map(data.nodes.map((node) => [node.id, node]));
  }, [data]);

  // Compute blocked by (unmet dependencies)
  const blockedBy = useMemo(() => {
    if (!selectedNode || !data) return [];
    return selectedNode.dependsOn.filter((depId) => {
      const dep = nodeIndex.get(depId);
      return dep && dep.status !== "done";
    });
  }, [selectedNode, nodeIndex, data]);

  const scaledWidth = svgWidth * scale;
  const scaledHeight = svgHeight * scale;
  const zoomPercent = Math.round(scale * 100);
  const minimapScale = Math.min(1, MINIMAP_WIDTH / svgWidth, MINIMAP_HEIGHT / svgHeight);
  const minimapWidth = svgWidth * minimapScale;
  const minimapHeight = svgHeight * minimapScale;
  const viewportRect = {
    x: Math.max(0, Math.min(viewport.x, svgWidth)),
    y: Math.max(0, Math.min(viewport.y, svgHeight)),
    width: Math.min(viewport.width, svgWidth),
    height: Math.min(viewport.height, svgHeight),
  };

  if (loading) {
    return (
      <div className="card">
        <div className="muted">Loading tech tree...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <div className="error">{error}</div>
        <button className="btn" onClick={() => void load()} style={{ marginTop: 10 }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {/* Floating header */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, pointerEvents: "auto" }}>
          {onClose && (
            <button
              className="btn"
              onClick={onClose}
              style={{ padding: "8px 16px", backgroundColor: "#ef4444" }}
            >
              ✕ Close
            </button>
          )}
          <div style={{ fontWeight: 700, color: "#fff", textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
            Tech Tree
          </div>
          <div style={{ color: "#888", fontSize: 13 }}>
            {data.nodes.length} work orders
          </div>
          {data.cycles.length > 0 && (
            <div className="error" style={{ fontSize: 13 }}>
              {data.cycles.length} cycle{data.cycles.length > 1 ? "s" : ""} detected
            </div>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", pointerEvents: "auto" }}>
          {/* Legend */}
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, backgroundColor: color, borderRadius: 2 }} />
              <span style={{ fontSize: 11, color: "#aaa" }}>{STATUS_LABELS[status as WorkOrderStatus]}</span>
            </div>
          ))}
          {eraColumns.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
              {eraColumns.map((lane) => (
                <div key={lane.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      backgroundColor: lane.color,
                      borderRadius: 2,
                      opacity: 0.6,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#aaa" }}>{lane.label}</span>
                </div>
              ))}
            </div>
          )}
          <button className="btnSecondary" onClick={() => void load()} style={{ marginLeft: 12 }}>
            Refresh
          </button>
        </div>
      </div>

      {/* Full-screen SVG Graph */}
      <div
        ref={containerRef}
        onScroll={updateViewport}
        onWheel={handleWheel}
        style={{
          flex: 1,
          overflow: "auto",
          backgroundColor: "#0a0a14",
          backgroundImage: "radial-gradient(circle, #1a1a2e 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div style={{ width: scaledWidth, height: scaledHeight }}>
          <svg
            width={svgWidth}
            height={svgHeight}
            style={{
              display: "block",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              transition: "transform 160ms ease-out",
              willChange: "transform",
            }}
          >
            {/* Era lanes */}
            {eraColumns.map((lane) => (
              <rect
                key={`era-bg-${lane.id}`}
                x={lane.x}
                y={0}
                width={lane.width}
                height={svgHeight}
                fill={lane.color}
                opacity={0.06}
              />
            ))}

            {/* Era labels */}
            {eraColumns.map((lane) => (
              <text
                key={`era-label-${lane.id}`}
                x={lane.x + NODE_WIDTH / 2}
                y={TOP_PADDING - 18}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={12}
                fontWeight={600}
              >
                {lane.label}
              </text>
            ))}

            {/* Lane backgrounds */}
            {lanes.map((lane) => {
              const laneColor = lane.color ?? "#334155";
              return (
                <rect
                  key={`lane-bg-${lane.id}`}
                  x={0}
                  y={lane.top}
                  width={svgWidth}
                  height={lane.height}
                  fill={laneColor}
                  opacity={0.08}
                />
              );
            })}

            {/* Edges */}
            {data.nodes.map((node) => {
              const to = nodePositions.get(node.id);
              if (!to) return null;

              return node.dependsOn.map((depId) => {
                const from = nodePositions.get(depId);
                if (!from) return null;
                const depNode = nodeIndex.get(depId);
                const isCrossProject = depNode
                  ? depNode.projectId !== repoId
                  : depId.includes(":");

                const isHighlightedDep = focusId === node.id && highlightedDeps.has(depId);
                const isHighlightedDependent = focusId === depId && highlightedDependents.has(node.id);
                const isHighlighted = isHighlightedDep || isHighlightedDependent;
                const isDimmed = focusId && !isHighlighted && focusId !== node.id && focusId !== depId;

                const x1 = from.x + NODE_WIDTH;
                const y1 = from.y + NODE_HEIGHT / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_HEIGHT / 2;

                const midX = (x1 + x2) / 2;
                const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

                let stroke = isCrossProject ? "#3b82f6" : "#555";
                if (isHighlightedDep) stroke = "#22c55e";
                if (isHighlightedDependent) stroke = "#3b82f6";

                return (
                  <path
                    key={`${depId}-${node.id}`}
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isHighlighted ? 3 : 1.5}
                    strokeDasharray={isCrossProject ? "6 4" : undefined}
                    opacity={isDimmed ? 0.2 : 1}
                    markerEnd={isHighlighted ? "url(#arrowhead)" : undefined}
                  />
                );
              });
            })}

            {/* Arrow marker */}
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#22c55e" />
              </marker>
            </defs>

            {/* Nodes */}
            {data.nodes.map((node) => {
              const pos = nodePositions.get(node.id);
              if (!pos) return null;

              const isSelected = selectedId === node.id;
              const isHovered = hoveredId === node.id;
              const isFocus = focusId === node.id;
              const isHighlighted = highlightedDeps.has(node.id) || highlightedDependents.has(node.id);
              const isDimmed = focusId && !isFocus && !isHighlighted;
              const inCycle = nodesInCycles.has(node.id);
              const showProjectName = node.isExternal && (isHovered || isSelected);

              const statusColor = STATUS_COLORS[node.status];

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setSelectedId(isSelected ? null : node.id)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  opacity={isDimmed ? 0.3 : 1}
                >
                  {/* Background */}
                  <rect
                    x={0}
                    y={0}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill="#2d2d44"
                    stroke={inCycle ? "#ef4444" : isSelected ? "#fff" : isHovered ? "#888" : "#444"}
                    strokeWidth={inCycle ? 3 : isSelected ? 2 : 1}
                  />

                  {/* Status bar */}
                  <rect x={0} y={0} width={6} height={NODE_HEIGHT} rx={3} fill={statusColor} />

                  {/* Status badge */}
                  <rect
                    x={NODE_WIDTH - 70}
                    y={6}
                    width={60}
                    height={18}
                    rx={4}
                    fill={statusColor}
                    opacity={0.8}
                  />
                  <text
                    x={NODE_WIDTH - 40}
                    y={18}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize={10}
                    fontWeight={600}
                  >
                    {STATUS_LABELS[node.status]}
                  </text>

                  {/* ID */}
                  <text x={14} y={18} fill="#888" fontSize={11}>
                    {node.id}
                  </text>

                  {/* Title */}
                  <text x={14} y={38} fill="#fff" fontSize={13} fontWeight={600}>
                    {node.title.length > 22 ? node.title.slice(0, 20) + "..." : node.title}
                  </text>

                  {/* Era + deps info */}
                  <text x={14} y={58} fill="#888" fontSize={10}>
                    {(node.era ?? "Unassigned") + " - "}
                    {node.dependsOn.length} deps - {node.dependents.length} unlocks
                  </text>

                  {showProjectName && (
                    <text x={14} y={72} fill="#60a5fa" fontSize={10}>
                      {node.projectName}
                    </text>
                  )}

                  {/* Cycle warning icon */}
                  {inCycle && (
                    <text x={NODE_WIDTH - 20} y={NODE_HEIGHT - 8} fill="#ef4444" fontSize={14}>
                      !
                    </text>
                  )}
                </g>
              );
            })}

            {/* Lane headers */}
            {lanes.map((lane) => {
              const laneColor = lane.color ?? "#334155";
              const nodeCount = lane.nodes.length;
              const indicator = lane.isCollapsed ? ">" : "v";
              return (
                <g
                  key={`lane-header-${lane.id}`}
                  onClick={() => toggleLane(lane.id)}
                  style={{ cursor: "pointer" }}
                >
                  <rect
                    x={0}
                    y={lane.top}
                    width={svgWidth}
                    height={LANE_HEADER_HEIGHT}
                    fill="#111827"
                    opacity={0.9}
                  />
                  <rect x={16} y={lane.top + 9} width={10} height={10} rx={2} fill={laneColor} />
                  <text x={32} y={lane.top + 20} fill="#e5e7eb" fontSize={12} fontWeight={600}>
                    {lane.name} - {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
                  </text>
                  <text
                    x={svgWidth - 16}
                    y={lane.top + 20}
                    textAnchor="end"
                    fill="#9ca3af"
                    fontSize={12}
                  >
                    {indicator}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Zoom + Minimap */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 9,
          pointerEvents: "auto",
        }}
      >
        <div className="card" style={{ padding: 8, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <button
              className="btnSecondary"
              onClick={zoomOut}
              style={{ padding: "6px 10px", minWidth: 32 }}
              aria-label="Zoom out"
              title="Zoom out (-)"
            >
              -
            </button>
            <div style={{ fontSize: 12, color: "#e5e7eb", minWidth: 54, textAlign: "center" }}>
              {zoomPercent}%
            </div>
            <button
              className="btnSecondary"
              onClick={zoomIn}
              style={{ padding: "6px 10px", minWidth: 32 }}
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              +
            </button>
            <button
              className="btnSecondary"
              onClick={fitToScreen}
              style={{ padding: "6px 10px" }}
              title="Fit to screen"
            >
              Fit
            </button>
            <button
              className="btnSecondary"
              onClick={resetZoom}
              style={{ padding: "6px 10px" }}
              title="Reset zoom (0)"
            >
              Reset
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>Ctrl/Cmd + Scroll to zoom</div>
        </div>

        <div className="card" style={{ padding: 8 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Overview</div>
          <div
            style={{
              width: MINIMAP_WIDTH,
              height: MINIMAP_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0f1320",
              borderRadius: 10,
              border: "1px solid #232a3d",
            }}
          >
            <svg
              width={minimapWidth}
              height={minimapHeight}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              onClick={handleMinimapClick}
              style={{ cursor: "pointer" }}
            >
              {data.nodes.map((node) => {
                const pos = nodePositions.get(node.id);
                if (!pos) return null;
                return (
                  <rect
                    key={`minimap-${node.id}`}
                    x={pos.x}
                    y={pos.y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill={STATUS_COLORS[node.status]}
                    opacity={0.65}
                  />
                );
              })}
              {viewportRect.width > 0 && viewportRect.height > 0 && (
                <rect
                  x={viewportRect.x}
                  y={viewportRect.y}
                  width={viewportRect.width}
                  height={viewportRect.height}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={3}
                />
              )}
            </svg>
          </div>
        </div>
      </div>

        {/* Detail Panel - Floating */}
        {selectedNode && (
          <section
            className="card"
            style={{
              position: "absolute",
              top: 70,
              right: 16,
              width: 300,
              maxHeight: "calc(100vh - 100px)",
              overflow: "auto",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>{selectedNode.id}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{selectedNode.title}</div>
                {selectedNode.isExternal && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Project: {selectedNode.projectName}
                  </div>
                )}
              </div>
              <button
                className="btnSecondary"
                onClick={() => setSelectedId(null)}
                style={{ padding: "4px 8px", fontSize: 12 }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <span
                className="badge"
                style={{ backgroundColor: STATUS_COLORS[selectedNode.status], color: "#fff" }}
              >
                {STATUS_LABELS[selectedNode.status]}
              </span>
              <span className="badge" style={{ marginLeft: 6 }}>
                {selectedNode.era ?? "Unassigned"}
              </span>
              <span className="badge" style={{ marginLeft: 6 }}>
                P{selectedNode.priority}
              </span>
            </div>

            {nodesInCycles.has(selectedNode.id) && (
              <div className="error" style={{ marginTop: 12, fontSize: 13 }}>
                This work order is part of a dependency cycle
              </div>
            )}

            {blockedBy.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Blocked by:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {blockedBy.map((depId) => {
                    const dep = data.nodes.find((n) => n.id === depId);
                    return (
                      <div
                        key={depId}
                        className="badge"
                        style={{
                          cursor: "pointer",
                          borderLeft: `3px solid ${STATUS_COLORS[dep?.status ?? "backlog"]}`,
                          paddingLeft: 8,
                        }}
                        onClick={() => setSelectedId(depId)}
                      >
                        {depId}: {dep?.title.slice(0, 25) ?? "Unknown"}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedNode.dependents.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Unlocks:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {selectedNode.dependents.map((depId) => {
                    const dep = data.nodes.find((n) => n.id === depId);
                    return (
                      <div
                        key={depId}
                        className="badge"
                        style={{
                          cursor: "pointer",
                          borderLeft: `3px solid ${STATUS_COLORS[dep?.status ?? "backlog"]}`,
                          paddingLeft: 8,
                        }}
                        onClick={() => setSelectedId(depId)}
                      >
                        {depId}: {dep?.title.slice(0, 25) ?? "Unknown"}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              {(() => {
                const rawId = selectedNode.id;
                const colonIndex = rawId.indexOf(":");
                const workOrderId =
                  selectedNode.isExternal && colonIndex >= 0
                    ? rawId.slice(colonIndex + 1)
                    : rawId;
                const targetProjectId = selectedNode.isExternal
                  ? selectedNode.projectId
                  : repoId;
                const label = selectedNode.isExternal
                  ? "Open External Work Order"
                  : "Open Work Order";
                return (
                  <Link
                    href={`/projects/${encodeURIComponent(targetProjectId)}/work-orders/${encodeURIComponent(workOrderId)}`}
                    className="btn"
                    style={{ width: "100%", textAlign: "center", display: "block" }}
                    onClick={onClose}
                  >
                    {label}
                  </Link>
                );
              })()}
            </div>
          </section>
        )}
    </div>
  );
}

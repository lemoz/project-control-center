"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 100;
const VERTICAL_GAP = 30;

export function TechTreeView({ repoId }: { repoId: string }) {
  const [data, setData] = useState<TechTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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

  // Calculate node positions based on dependency depth
  const { nodePositions, svgWidth, svgHeight } = useMemo(() => {
    if (!data) return { nodePositions: new Map<string, { x: number; y: number }>(), svgWidth: 800, svgHeight: 600 };

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

    // Group nodes by depth
    const nodesByDepth = new Map<number, DependencyNode[]>();
    for (const node of nodes) {
      const d = depths.get(node.id) ?? 0;
      const list = nodesByDepth.get(d) ?? [];
      list.push(node);
      nodesByDepth.set(d, list);
    }

    // Sort each depth column by priority, then by title
    for (const [d, list] of nodesByDepth) {
      list.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.title.localeCompare(b.title);
      });
      nodesByDepth.set(d, list);
    }

    // Calculate positions
    const maxDepth = Math.max(...Array.from(depths.values()), 0);
    let totalHeight = 0;

    for (let d = 0; d <= maxDepth; d++) {
      const list = nodesByDepth.get(d) ?? [];
      const columnHeight = list.length * (NODE_HEIGHT + VERTICAL_GAP);
      totalHeight = Math.max(totalHeight, columnHeight);
    }

    for (let d = 0; d <= maxDepth; d++) {
      const list = nodesByDepth.get(d) ?? [];
      const columnHeight = list.length * (NODE_HEIGHT + VERTICAL_GAP);
      const startY = (totalHeight - columnHeight) / 2 + 50;

      list.forEach((node, idx) => {
        positions.set(node.id, {
          x: 50 + d * (NODE_WIDTH + HORIZONTAL_GAP),
          y: startY + idx * (NODE_HEIGHT + VERTICAL_GAP),
        });
      });
    }

    const width = 100 + (maxDepth + 1) * (NODE_WIDTH + HORIZONTAL_GAP);
    const height = totalHeight + 100;

    return { nodePositions: positions, svgWidth: Math.max(800, width), svgHeight: Math.max(400, height) };
  }, [data]);

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

  // Compute blocked by (unmet dependencies)
  const blockedBy = useMemo(() => {
    if (!selectedNode || !data) return [];
    const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));
    return selectedNode.dependsOn.filter((depId) => {
      const dep = nodeMap.get(depId);
      return dep && dep.status !== "done";
    });
  }, [selectedNode, data]);

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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>Tech Tree</div>
        <div className="muted" style={{ fontSize: 13 }}>
          {data.nodes.length} work orders
        </div>
        {data.cycles.length > 0 && (
          <div className="error" style={{ fontSize: 13 }}>
            {data.cycles.length} cycle{data.cycles.length > 1 ? "s" : ""} detected
          </div>
        )}
        <button className="btn" onClick={() => void load()} style={{ marginLeft: "auto" }}>
          Refresh
        </button>
      </section>

      {/* Legend */}
      <section className="card" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Status:</div>
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 12, height: 12, backgroundColor: color, borderRadius: 2 }} />
            <span style={{ fontSize: 12 }}>{STATUS_LABELS[status as WorkOrderStatus]}</span>
          </div>
        ))}
        <div style={{ marginLeft: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 20, height: 2, backgroundColor: "#22c55e" }} />
            <span style={{ fontSize: 12 }}>Dependencies</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 20, height: 2, backgroundColor: "#3b82f6" }} />
            <span style={{ fontSize: 12 }}>Dependents</span>
          </div>
        </div>
      </section>

      {/* Main view */}
      <div style={{ display: "flex", gap: 12 }}>
        {/* SVG Graph */}
        <section
          className="card"
          style={{
            flex: 1,
            overflow: "auto",
            backgroundColor: "#1a1a2e",
            backgroundImage: "radial-gradient(circle, #2a2a4e 1px, transparent 1px)",
            backgroundSize: "20px 20px",
            minHeight: 400,
          }}
        >
          <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
            {/* Edges */}
            {data.nodes.map((node) => {
              const to = nodePositions.get(node.id);
              if (!to) return null;

              return node.dependsOn.map((depId) => {
                const from = nodePositions.get(depId);
                if (!from) return null;

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

                let stroke = "#555";
                if (isHighlightedDep) stroke = "#22c55e";
                if (isHighlightedDependent) stroke = "#3b82f6";

                return (
                  <path
                    key={`${depId}-${node.id}`}
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isHighlighted ? 3 : 1.5}
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
                    {node.era ? `${node.era} - ` : ""}
                    {node.dependsOn.length} deps - {node.dependents.length} unlocks
                  </text>

                  {/* Cycle warning icon */}
                  {inCycle && (
                    <text x={NODE_WIDTH - 20} y={NODE_HEIGHT - 8} fill="#ef4444" fontSize={14}>
                      !
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </section>

        {/* Detail Panel */}
        {selectedNode && (
          <section className="card" style={{ width: 280, flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>{selectedNode.id}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{selectedNode.title}</div>
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
              {selectedNode.era && (
                <span className="badge" style={{ marginLeft: 6 }}>
                  {selectedNode.era}
                </span>
              )}
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
              <Link
                href={`/projects/${encodeURIComponent(repoId)}/work-orders/${encodeURIComponent(selectedNode.id)}`}
                className="btn"
                style={{ width: "100%", textAlign: "center", display: "block" }}
              >
                Open Work Order
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

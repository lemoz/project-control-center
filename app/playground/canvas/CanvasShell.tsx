"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEventHandler } from "react";
import Link from "next/link";
import type { Visualization, VisualizationNode } from "./types";
import { EscalationBadge } from "./EscalationBadge";
import { ProjectPopup } from "./ProjectPopup";
import { useProjectsVisualization } from "./useProjectsVisualization";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { defaultVisualizationId, findVisualization, visualizations } from "./visualizations";
import type { RiverBubbleDetails } from "./visualizations/TimelineRiverViz";

const TOOLTIP_OFFSET = 14;
const CLICK_THRESHOLD = 4;

type BubbleHitTestVisualization = Visualization & {
  getBubbleAtPoint: (point: { x: number; y: number }) => RiverBubbleDetails | null;
  setSelectedBubbleId?: (id: string | null) => void;
};

function supportsBubbleHitTest(
  visualization: Visualization | null
): visualization is BubbleHitTestVisualization {
  return Boolean(visualization && "getBubbleAtPoint" in visualization);
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

export function CanvasShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vizRef = useRef<Visualization | null>(null);
  const [selectedVizId, setSelectedVizId] = useState(defaultVisualizationId);
  const [selectedRun, setSelectedRun] = useState<RiverBubbleDetails | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastFrame = useRef<number | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const { data, loading, error, refresh, lastUpdated } = useProjectsVisualization();

  const {
    transform,
    setTransform,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    handlers,
  } = useCanvasInteraction({ canvasRef, nodes: data.nodes });
  const transformRef = useRef(transform);
  const selectedRef = useRef(selectedNode);
  const hoveredRef = useRef(hoveredNode);
  const sizeRef = useRef(canvasSize);

  const selectedSummary = useMemo(() => {
    if (!selectedNode) return "None";
    return selectedNode.name;
  }, [selectedNode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const definition = findVisualization(selectedVizId);
    const visualization = definition.create();
    vizRef.current?.destroy();
    vizRef.current = visualization;
    visualization.init(canvas, data);
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
    vizRef.current?.onNodeHover?.(hoveredNode);
  }, [hoveredNode]);

  useEffect(() => {
    sizeRef.current = canvasSize;
  }, [canvasSize]);

  const handlePointerDown = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      pointerDownRef.current = { x: event.clientX, y: event.clientY };
      handlers.onPointerDown(event);
    },
    [handlers]
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
      const clickedNode = findNodeAtPoint(data.nodes, worldPoint);
      if (clickedNode) {
        vizRef.current?.onNodeClick?.(clickedNode);
      }
      setSelectedRun(null);
    },
    [data.nodes, handlers, transform]
  );

  const handlePointerLeave = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      pointerDownRef.current = null;
      handlers.onPointerLeave(event);
    },
    [handlers]
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
            onWheel={handlers.onWheel}
          />

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
              <div style={{ fontWeight: 600 }}>{hoveredNode.name}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Status {hoveredNode.status} | Consumption {hoveredNode.consumptionRate} t/day
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Activity {formatPercent(hoveredNode.activityLevel)} | Health {formatPercent(hoveredNode.health)}
              </div>
              {hoveredNode.escalationCount > 0 && (
                <div style={{ marginTop: 6 }}>
                  <EscalationBadge count={hoveredNode.escalationCount} compact />
                </div>
              )}
            </div>
          )}

          {selectedNode && !selectedRun && <ProjectPopup node={selectedNode} />}

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
        {selectedNode && (
          <div className="muted" style={{ fontSize: 13 }}>
            Status {selectedNode.status} | Active {selectedNode.isActive ? "yes" : "no"} | Success {formatPercent(
              selectedNode.successProgress
            )}
          </div>
        )}
        {selectedNode && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <EscalationBadge count={selectedNode.escalationCount} />
            <div className="muted" style={{ fontSize: 12 }}>
              Last activity: {formatActivity(selectedNode.lastActivity)}
            </div>
          </div>
        )}
      </section>
      )}
    </main>
  );
}

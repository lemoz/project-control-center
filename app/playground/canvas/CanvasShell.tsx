"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Visualization } from "./types";
import { EscalationBadge } from "./EscalationBadge";
import { ProjectPopup } from "./ProjectPopup";
import { useProjectsVisualization } from "./useProjectsVisualization";
import { useCanvasInteraction } from "./useCanvasInteraction";
import { defaultVisualizationId, findVisualization, visualizations } from "./visualizations";

const TOOLTIP_OFFSET = 14;

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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0, dpr: 1 });
  const lastFrame = useRef<number | null>(null);

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
    sizeRef.current = canvasSize;
  }, [canvasSize]);

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
    <main style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="card" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href="/" className="badge">
          &larr; Portfolio
        </Link>
        <div>
          <h2 style={{ margin: 0 }}>Canvas Playground</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Ambient canvas shell for spatial project experiments.
          </div>
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
        </div>
      </section>

      <section className="card" style={{ position: "relative", minHeight: 520, padding: 0 }}>
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            height: 520,
            overflow: "hidden",
            borderRadius: 12,
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
            {...handlers}
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

          {selectedNode && <ProjectPopup node={selectedNode} />}

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
    </main>
  );
}

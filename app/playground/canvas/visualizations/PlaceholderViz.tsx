import type { Visualization, VisualizationData, VisualizationNode } from "../types";

type StatusColor = {
  fill: string;
  outline: string;
};

const STATUS_COLORS: Record<VisualizationNode["status"], StatusColor> = {
  active: { fill: "#2b5cff", outline: "#88a6ff" },
  blocked: { fill: "#ef4444", outline: "#f9a8a8" },
  parked: { fill: "#64748b", outline: "#94a3b8" },
};

function radiusFromConsumption(consumptionRate: number, activityLevel: number): number {
  const base = 16 + Math.sqrt(Math.max(consumptionRate, 0)) * 0.8;
  return base + activityLevel * 6;
}

function applyLayout(nodes: VisualizationNode[]): void {
  if (!nodes.length) return;
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rows = Math.ceil(nodes.length / columns);
  const spacing = 140;

  nodes.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    node.x = (col - (columns - 1) / 2) * spacing;
    node.y = (row - (rows - 1) / 2) * spacing;
    node.radius = radiusFromConsumption(node.consumptionRate, node.activityLevel);
  });
}

export class PlaceholderVisualization implements Visualization {
  id = "placeholder";
  name = "Placeholder";
  description = "Simple grid layout to validate the canvas shell.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };

  init(canvas: HTMLCanvasElement, data: VisualizationData): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.update(data);
  }

  update(data: VisualizationData): void {
    this.data = data;
    applyLayout(this.data.nodes);
  }

  render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();

    for (const node of this.data.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const radius = node.radius ?? 16;
      const colors = STATUS_COLORS[node.status];
      const label = node.label;

      ctx.fillStyle = colors.fill;
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = node.isActive ? 2 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (node.needsHuman) {
        const dotRadius = 6;
        ctx.fillStyle = "#ff5c6a";
        ctx.beginPath();
        ctx.arc(node.x + radius * 0.55, node.y - radius * 0.55, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        if (node.escalationCount > 1) {
          ctx.fillStyle = "#fff";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            String(node.escalationCount),
            node.x + radius * 0.55,
            node.y - radius * 0.55
          );
        }
      }

      ctx.fillStyle = "#e6e8ee";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, node.x, node.y + radius + 6);
    }

    ctx.restore();
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
  }
}

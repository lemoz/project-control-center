import type { ProjectNode, Visualization, VisualizationData, WorkOrderNode, WorkOrderStatus } from "../types";

export type HeatmapGrouping = "none" | "project" | "status" | "priority" | "era";

export type HeatmapLayoutOptions = {
  grouping: HeatmapGrouping;
};

type HeatmapNode = ProjectNode | WorkOrderNode;

type LayoutGroup = {
  key: string;
  label: string;
  nodes: HeatmapNode[];
  x: number;
  y: number;
  width: number;
  height: number;
  labelX: number;
  labelY: number;
  labelAlign: CanvasTextAlign;
};

const WORK_ORDER_STATUS_ORDER: WorkOrderStatus[] = [
  "building",
  "ai_review",
  "you_review",
  "ready",
  "backlog",
  "blocked",
  "done",
  "parked",
];

const PROJECT_STATUS_ORDER: ProjectNode["status"][] = ["active", "blocked", "parked"];

const STATUS_COLORS: Record<WorkOrderStatus, string> = {
  done: "#22c55e",
  ready: "#22c55e",
  building: "#facc15",
  ai_review: "#facc15",
  you_review: "#facc15",
  blocked: "#ef4444",
  backlog: "#6b7280",
  parked: "#64748b",
};

const BACKGROUND_RGB = { r: 11, g: 13, b: 18 };
const LABEL_COLOR = "rgba(225, 231, 242, 0.85)";

const MAX_COLUMNS = 14;
const COLUMN_MAX_ROWS = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function mixColor(
  base: { r: number; g: number; b: number },
  color: { r: number; g: number; b: number },
  t: number
): string {
  const weight = clamp(t, 0, 1);
  const r = Math.round(base.r + (color.r - base.r) * weight);
  const g = Math.round(base.g + (color.g - base.g) * weight);
  const b = Math.round(base.b + (color.b - base.b) * weight);
  return `rgb(${r}, ${g}, ${b})`;
}

function applyIntensity(hex: string, intensity: number): string {
  const base = hexToRgb(hex);
  return mixColor(BACKGROUND_RGB, base, clamp(intensity, 0, 1));
}

function tileSizeForCount(count: number): number {
  if (count > 220) return 14;
  if (count > 140) return 18;
  if (count > 90) return 22;
  return 26;
}

function formatStatusLabel(value: string): string {
  return value.replace(/_/g, " ").toUpperCase();
}

function tileLabel(node: HeatmapNode): string {
  if (node.type === "work_order") return node.label;
  const trimmed = node.name.replace(/[^a-z0-9]/gi, "");
  if (trimmed.length <= 4) return trimmed.toUpperCase();
  return trimmed.slice(0, 4).toUpperCase();
}

function statusColorForNode(node: HeatmapNode): string {
  if (node.type === "work_order") {
    return STATUS_COLORS[node.status] ?? STATUS_COLORS.backlog;
  }
  if (node.status === "blocked" || node.needsHuman || node.health < 0.35) return "#ef4444";
  if (node.status === "parked") return "#64748b";
  if (node.health < 0.6) return "#f59e0b";
  return "#22c55e";
}

function groupingKey(node: HeatmapNode, grouping: HeatmapGrouping): string {
  switch (grouping) {
    case "project":
      return node.type === "work_order" ? node.projectName : node.name;
    case "status":
      return node.status;
    case "priority":
      return String(node.priority ?? 3);
    case "era":
      return node.era ?? "Unassigned";
    case "none":
    default:
      return "all";
  }
}

function groupingLabel(grouping: HeatmapGrouping, key: string): string {
  switch (grouping) {
    case "status":
      return formatStatusLabel(key);
    case "priority":
      return `Priority ${key}`;
    case "project":
      return key;
    case "era":
      return key === "Unassigned" ? "Era: unassigned" : `Era: ${key}`;
    case "none":
    default:
      return "All Work Orders";
  }
}

function orderedGroupKeys(
  nodes: HeatmapNode[],
  grouping: HeatmapGrouping,
  groups: Map<string, HeatmapNode[]>
): string[] {
  const keys = Array.from(groups.keys());
  if (grouping === "status") {
    const usesWorkOrders = nodes.some((node) => node.type === "work_order");
    const order = usesWorkOrders ? WORK_ORDER_STATUS_ORDER : PROJECT_STATUS_ORDER;
    return order.filter((status) => groups.has(status));
  }
  if (grouping === "priority") {
    return ["1", "2", "3", "4", "5"].filter((key) => groups.has(key));
  }
  if (grouping === "project") {
    return keys.sort((a, b) => a.localeCompare(b));
  }
  if (grouping === "era") {
    return keys.sort((a, b) => a.localeCompare(b));
  }
  return ["all"];
}

function sortNodes(nodes: HeatmapNode[]): HeatmapNode[] {
  return nodes.slice().sort((a, b) => {
    const priorityDelta = (a.priority ?? 3) - (b.priority ?? 3);
    if (priorityDelta !== 0) return priorityDelta;
    return tileLabel(a).localeCompare(tileLabel(b));
  });
}

export class HeatmapGridVisualization implements Visualization {
  id = "heatmap_grid";
  name = "Heatmap Grid";
  description = "Dense status grid for quick health snapshots.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };
  private nodes: HeatmapNode[] = [];
  private layoutGroups: LayoutGroup[] = [];
  private layoutOptions: HeatmapLayoutOptions = { grouping: "status" };
  private tileSize = 24;
  private nodePhases = new Map<string, number>();

  init(canvas: HTMLCanvasElement, data: VisualizationData): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.update(data);
  }

  update(data: VisualizationData): void {
    this.data = data;
    this.applyLayout();
  }

  setLayoutOptions(options: HeatmapLayoutOptions): void {
    this.layoutOptions = options;
    this.applyLayout();
  }

  private resolveNodes(): HeatmapNode[] {
    if (this.data.workOrderNodes && this.data.workOrderNodes.length > 0) {
      return this.data.workOrderNodes;
    }
    return this.data.nodes;
  }

  private syncPhases(nodes: HeatmapNode[]): void {
    const seen = new Set<string>();
    for (const node of nodes) {
      seen.add(node.id);
      if (!this.nodePhases.has(node.id)) {
        this.nodePhases.set(node.id, Math.random() * Math.PI * 2);
      }
    }
    for (const key of this.nodePhases.keys()) {
      if (!seen.has(key)) this.nodePhases.delete(key);
    }
  }

  private buildGroups(nodes: HeatmapNode[]): LayoutGroup[] {
    const grouping = this.layoutOptions.grouping;
    const groups = new Map<string, HeatmapNode[]>();

    for (const node of nodes) {
      const key = groupingKey(node, grouping);
      const list = groups.get(key);
      if (list) {
        list.push(node);
      } else {
        groups.set(key, [node]);
      }
    }

    const orderedKeys = orderedGroupKeys(nodes, grouping, groups);
    return orderedKeys.map((key) => ({
      key,
      label: groupingLabel(grouping, key),
      nodes: sortNodes(groups.get(key) ?? []),
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      labelX: 0,
      labelY: 0,
      labelAlign: "left",
    }));
  }

  private layoutStackedGroups(groups: LayoutGroup[], tileSize: number, gap: number): LayoutGroup[] {
    const labelOffset =
      this.layoutOptions.grouping === "none" ? 0 : Math.max(18, tileSize * 0.9);
    const groupGap = Math.max(16, tileSize);
    const prepared = groups.map((group) => {
      const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(group.nodes.length))));
      const rows = Math.max(1, Math.ceil(group.nodes.length / columns));
      const width = columns * tileSize + (columns - 1) * gap;
      const height = rows * tileSize + (rows - 1) * gap;
      return { group, columns, rows, width, height };
    });

    const totalHeight =
      prepared.reduce((sum, entry) => sum + entry.height + labelOffset, 0) +
      groupGap * Math.max(0, prepared.length - 1);
    const maxWidth = prepared.reduce((best, entry) => Math.max(best, entry.width), 0);
    let cursorY = -totalHeight / 2;

    return prepared.map((entry) => {
      const { group, columns, width, height } = entry;
      const startX = -maxWidth / 2;
      const startY = cursorY + labelOffset;
      const labelY = startY - labelOffset * 0.6;

      group.nodes.forEach((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        node.x = startX + col * (tileSize + gap) + tileSize / 2;
        node.y = startY + row * (tileSize + gap) + tileSize / 2;
        node.radius = tileSize / 2;
      });

      cursorY += height + labelOffset + groupGap;

      return {
        ...group,
        x: startX,
        y: startY,
        width,
        height,
        labelX: startX,
        labelY,
        labelAlign: "left",
      };
    });
  }

  private layoutColumnGroups(groups: LayoutGroup[], tileSize: number, gap: number): LayoutGroup[] {
    const labelOffset = Math.max(18, tileSize * 0.9);
    const groupGap = Math.max(14, tileSize * 0.7);

    const prepared = groups.map((group) => {
      const columns = Math.max(1, Math.ceil(group.nodes.length / COLUMN_MAX_ROWS));
      const rows = Math.max(1, Math.ceil(group.nodes.length / columns));
      const width = columns * tileSize + (columns - 1) * gap;
      const height = rows * tileSize + (rows - 1) * gap;
      return { group, columns, rows, width, height };
    });

    const totalWidth =
      prepared.reduce((sum, entry) => sum + entry.width, 0) +
      groupGap * Math.max(0, prepared.length - 1);
    const maxHeight = prepared.reduce((best, entry) => Math.max(best, entry.height), 0);
    const startY = -maxHeight / 2 + labelOffset;
    const labelY = startY - labelOffset * 0.6;
    let cursorX = -totalWidth / 2;

    return prepared.map((entry) => {
      const { group, columns, width, height } = entry;
      const startX = cursorX;
      group.nodes.forEach((node, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        node.x = startX + col * (tileSize + gap) + tileSize / 2;
        node.y = startY + row * (tileSize + gap) + tileSize / 2;
        node.radius = tileSize / 2;
      });
      cursorX += width + groupGap;

      return {
        ...group,
        x: startX,
        y: startY,
        width,
        height,
        labelX: startX + width / 2,
        labelY,
        labelAlign: "center",
      };
    });
  }

  private applyLayout(): void {
    const nodes = this.resolveNodes();
    this.nodes = nodes;
    this.syncPhases(nodes);

    if (!nodes.length) {
      this.layoutGroups = [];
      return;
    }

    const tileSize = tileSizeForCount(nodes.length);
    const gap = Math.max(4, Math.round(tileSize * 0.35));
    const groups = this.buildGroups(nodes);
    const layout =
      this.layoutOptions.grouping === "status"
        ? this.layoutColumnGroups(groups, tileSize, gap)
        : this.layoutStackedGroups(groups, tileSize, gap);

    this.tileSize = tileSize;
    this.layoutGroups = layout;
  }

  render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now();

    ctx.save();

    if (this.layoutOptions.grouping !== "none") {
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = "11px system-ui";
      for (const group of this.layoutGroups) {
        if (!group.label) continue;
        ctx.textAlign = group.labelAlign;
        ctx.textBaseline = "middle";
        ctx.fillText(group.label, group.labelX, group.labelY);
      }
    }

    for (const node of this.nodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const baseColor = statusColorForNode(node);
      const baseIntensity = 0.25 + clamp(node.activityLevel, 0, 1) * 0.7;
      const phase = this.nodePhases.get(node.id) ?? 0;
      const pulse =
        node.isActive ? 0.08 * Math.sin(now / 650 + phase) : 0;
      const intensity = clamp(baseIntensity + pulse, 0.15, 1);
      const size = this.tileSize;
      const half = size / 2;

      ctx.fillStyle = applyIntensity(baseColor, intensity);
      ctx.fillRect(node.x - half, node.y - half, size, size);

      ctx.strokeStyle = node.isActive ? "rgba(255, 255, 255, 0.35)" : "rgba(255, 255, 255, 0.12)";
      ctx.lineWidth = 1;
      ctx.strokeRect(node.x - half + 0.5, node.y - half + 0.5, size - 1, size - 1);

      if (size >= 20) {
        ctx.fillStyle =
          intensity > 0.6 ? "rgba(10, 12, 18, 0.8)" : "rgba(245, 247, 255, 0.9)";
        ctx.font = `600 ${Math.max(9, Math.round(size * 0.35))}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tileLabel(node), node.x, node.y + 1);
      }
    }

    ctx.restore();
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
  }
}

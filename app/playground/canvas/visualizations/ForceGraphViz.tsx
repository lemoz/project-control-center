import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type {
  ProjectNode,
  Visualization,
  VisualizationData,
  VisualizationNode,
  WorkOrderNode,
} from "../types";

type ProjectForceNode = ProjectNode &
  SimulationNodeDatum & {
    radius: number;
  };

type WorkOrderForceNode = WorkOrderNode &
  SimulationNodeDatum & {
    radius: number;
  };

type ForceNode = ProjectForceNode | WorkOrderForceNode;

type ForceLink = SimulationLinkDatum<ForceNode> & {
  type: string;
};

const COLORS = {
  background: "#0b0d12",
  projectActive: "#60a5fa",
  projectIdle: "#22c55e",
  projectBlocked: "#f87171",
  projectParked: "#94a3b8",
  workOrderReady: "#93c5fd",
  workOrderBuilding: "#22d3ee",
  workOrderReview: "#a855f7",
  workOrderWaiting: "#fbbf24",
  workOrderDone: "#64748b",
  workOrderBlocked: "#ef4444",
  workOrderBacklog: "#475569",
  link: "#475569",
  linkFaint: "#22293a",
  linkHighlight: "#e2e8f0",
  label: "#e2e8f0",
  labelMuted: "#94a3b8",
};

const PROJECT_BASE_RADIUS = 30;
const PROJECT_ACTIVE_BOOST = 10;
const WORK_ORDER_RADII: Record<string, number> = {
  backlog: 12,
  ready: 15,
  building: 20,
  ai_review: 18,
  you_review: 18,
  done: 10,
  blocked: 15,
  parked: 12,
};

const LINK_DISTANCE = 90;
const PROJECT_LINK_DISTANCE = 64;
const DEPENDENCY_DISTANCE = 110;
const CHARGE_PROJECT = -240;
const CHARGE_WORK_ORDER = -180;
const COLLISION_PADDING = 6;
const ARROW_SIZE = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededFloat(seed: string): number {
  const hash = hashString(seed);
  return (hash % 1000) / 1000;
}

function seededPosition(seed: string): { x: number; y: number } {
  const angle = seededFloat(`${seed}-angle`) * Math.PI * 2;
  const radius = 120 + seededFloat(`${seed}-radius`) * 180;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function projectRadius(node: ProjectNode): number {
  const scaled = Math.log10(Math.max(1, node.consumptionRate));
  const base = PROJECT_BASE_RADIUS + scaled * 6;
  const boost = node.isActive ? PROJECT_ACTIVE_BOOST : 0;
  return clamp(base + boost, 24, 58);
}

function workOrderRadius(node: WorkOrderNode): number {
  const base = WORK_ORDER_RADII[node.status] ?? 14;
  return clamp(base, 10, 24);
}

function nodeRadius(node: VisualizationNode): number {
  return node.type === "project"
    ? projectRadius(node)
    : workOrderRadius(node);
}

function projectColor(node: ProjectNode): string {
  if (node.needsHuman || node.status === "blocked") return COLORS.projectBlocked;
  if (node.status === "parked") return COLORS.projectParked;
  if (!node.isActive) return COLORS.projectIdle;
  return COLORS.projectActive;
}

function workOrderColor(node: WorkOrderNode): string {
  switch (node.status) {
    case "building":
      return COLORS.workOrderBuilding;
    case "ai_review":
    case "you_review":
      return COLORS.workOrderReview;
    case "blocked":
      return COLORS.workOrderBlocked;
    case "done":
      return COLORS.workOrderDone;
    case "ready":
      return COLORS.workOrderReady;
    case "parked":
      return COLORS.workOrderBacklog;
    case "backlog":
      return COLORS.workOrderBacklog;
    default:
      return COLORS.workOrderWaiting;
  }
}

function resolveLabel(node: ForceNode): string {
  if (node.type === "work_order") return node.label;
  return node.label ?? node.name;
}

function isWorkOrderNode(node: ForceNode): node is WorkOrderForceNode {
  return node.type === "work_order";
}

export class ForceGraphVisualization implements Visualization {
  id = "force_graph";
  name = "Force-Directed Graph";
  description = "Physics-driven cluster map of projects and work orders.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };
  private simulation: Simulation<ForceNode, ForceLink> | null = null;
  private nodes = new Map<string, ForceNode>();
  private nodeList: ForceNode[] = [];
  private links: ForceLink[] = [];
  private dataNodeRefs = new Map<string, VisualizationNode>();
  private hoveredId: string | null = null;
  private selectedId: string | null = null;

  init(canvas: HTMLCanvasElement, data: VisualizationData): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.update(data);
  }

  update(data: VisualizationData): void {
    this.data = data;
    const incomingNodes = [
      ...data.nodes,
      ...(data.workOrderNodes ?? []),
    ];
    const seen = new Set<string>();
    const nextNodes: ForceNode[] = [];
    const nextRefs = new Map<string, VisualizationNode>();

    for (const incoming of incomingNodes) {
      const existing = this.nodes.get(incoming.id);
      const radius = nodeRadius(incoming);
      if (existing) {
        const { x, y, vx, vy, fx, fy } = existing;
        Object.assign(existing, incoming);
        existing.radius = radius;
        existing.x = x ?? incoming.x ?? seededPosition(incoming.id).x;
        existing.y = y ?? incoming.y ?? seededPosition(incoming.id).y;
        existing.vx = vx ?? 0;
        existing.vy = vy ?? 0;
        if (fx !== undefined) existing.fx = fx;
        if (fy !== undefined) existing.fy = fy;
      } else {
        const position = seededPosition(incoming.id);
        const created: ForceNode = {
          ...(incoming as ForceNode),
          radius,
          x: incoming.x ?? position.x,
          y: incoming.y ?? position.y,
          vx: 0,
          vy: 0,
        };
        this.nodes.set(incoming.id, created);
      }
      const node = this.nodes.get(incoming.id);
      if (!node) continue;
      node.radius = radius;
      incoming.x = node.x;
      incoming.y = node.y;
      incoming.radius = radius;
      nextNodes.push(node);
      seen.add(incoming.id);
      nextRefs.set(incoming.id, incoming);
    }

    for (const id of this.nodes.keys()) {
      if (!seen.has(id)) this.nodes.delete(id);
    }
    if (this.selectedId && !this.nodes.has(this.selectedId)) {
      this.selectedId = null;
    }
    if (this.hoveredId && !this.nodes.has(this.hoveredId)) {
      this.hoveredId = null;
    }

    const links: ForceLink[] = [];
    for (const edge of data.edges) {
      const source = this.nodes.get(edge.source);
      const target = this.nodes.get(edge.target);
      if (!source || !target) continue;
      links.push({ source, target, type: edge.type });
    }

    this.nodeList = nextNodes;
    this.links = links;
    this.dataNodeRefs = nextRefs;

    if (!this.simulation) {
      this.simulation = forceSimulation(this.nodeList)
        .force(
          "link",
          forceLink<ForceNode, ForceLink>(this.links)
            .distance((link) => {
              if (link.type === "project_link") return PROJECT_LINK_DISTANCE;
              if (link.type === "depends_on") return DEPENDENCY_DISTANCE;
              return LINK_DISTANCE;
            })
            .strength((link) => (link.type === "project_link" ? 0.6 : 0.5))
        )
        .force(
          "charge",
          forceManyBody<ForceNode>().strength((node) =>
            node.type === "project" ? CHARGE_PROJECT : CHARGE_WORK_ORDER
          )
        )
        .force("center", forceCenter(0, 0))
        .force(
          "collision",
          forceCollide<ForceNode>().radius((node) => node.radius + COLLISION_PADDING)
        );
      this.simulation.alphaDecay(0.05);
      this.simulation.velocityDecay(0.35);
    } else {
      this.simulation.nodes(this.nodeList);
      const linkForce = this.simulation.force("link") as unknown as
        | { links: (links: ForceLink[]) => void }
        | null;
      linkForce?.links(this.links);
      this.simulation.alpha(0.9).restart();
    }
  }

  onNodeHover(node: VisualizationNode | null): void {
    this.hoveredId = node?.id ?? null;
  }

  onNodeClick(node: VisualizationNode | null): void {
    this.selectedId = node?.id ?? null;
  }

  onNodeDragStart(node: VisualizationNode, point: { x: number; y: number }): void {
    const target = this.nodes.get(node.id);
    if (!target || !this.simulation) return;
    target.fx = point.x;
    target.fy = point.y;
    this.simulation.alphaTarget(0.25).restart();
  }

  onNodeDrag(node: VisualizationNode, point: { x: number; y: number }): void {
    const target = this.nodes.get(node.id);
    if (!target) return;
    target.fx = point.x;
    target.fy = point.y;
  }

  onNodeDragEnd(node: VisualizationNode): void {
    const target = this.nodes.get(node.id);
    if (!target || !this.simulation) return;
    target.fx = null;
    target.fy = null;
    this.simulation.alphaTarget(0);
  }

  render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now();

    for (const node of this.nodeList) {
      const ref = this.dataNodeRefs.get(node.id);
      if (!ref) continue;
      ref.x = node.x;
      ref.y = node.y;
      ref.radius = node.radius;
    }

    const activeId = this.hoveredId ?? this.selectedId;
    const connectedIds = new Set<string>();
    if (activeId) {
      for (const link of this.links) {
        const sourceId =
          typeof link.source === "string" || typeof link.source === "number"
            ? String(link.source)
            : link.source.id;
        const targetId =
          typeof link.target === "string" || typeof link.target === "number"
            ? String(link.target)
            : link.target.id;
        if (sourceId === activeId || targetId === activeId) {
          connectedIds.add(sourceId);
          connectedIds.add(targetId);
        }
      }
    }

    for (const link of this.links) {
      const source =
        typeof link.source === "string" || typeof link.source === "number"
          ? this.nodes.get(String(link.source))
          : link.source;
      const target =
        typeof link.target === "string" || typeof link.target === "number"
          ? this.nodes.get(String(link.target))
          : link.target;
      if (
        !source ||
        !target ||
        source.x === undefined ||
        source.y === undefined ||
        target.x === undefined ||
        target.y === undefined
      ) {
        continue;
      }

      const isActive =
        activeId &&
        (source.id === activeId || target.id === activeId) &&
        connectedIds.size > 0;
      const dimmed = activeId && !isActive;
      const baseColor = link.type === "project_link" ? COLORS.linkFaint : COLORS.link;
      const stroke = isActive ? COLORS.linkHighlight : baseColor;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const offsetSource = (source.radius ?? 12) + 2;
      const offsetTarget = (target.radius ?? 12) + 2;
      const sx = source.x + (dx / distance) * offsetSource;
      const sy = source.y + (dy / distance) * offsetSource;
      const tx = target.x - (dx / distance) * offsetTarget;
      const ty = target.y - (dy / distance) * offsetTarget;

      ctx.save();
      ctx.strokeStyle = dimmed ? withAlpha(stroke, 0.2) : stroke;
      ctx.lineWidth = link.type === "depends_on" ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();

      if (link.type === "depends_on") {
        const angle = Math.atan2(ty - sy, tx - sx);
        const arrowX = tx;
        const arrowY = ty;
        ctx.fillStyle = dimmed ? withAlpha(stroke, 0.2) : stroke;
        ctx.beginPath();
        ctx.moveTo(
          arrowX - Math.cos(angle) * ARROW_SIZE,
          arrowY - Math.sin(angle) * ARROW_SIZE
        );
        ctx.lineTo(
          arrowX - Math.cos(angle - Math.PI / 6) * ARROW_SIZE,
          arrowY - Math.sin(angle - Math.PI / 6) * ARROW_SIZE
        );
        ctx.lineTo(
          arrowX - Math.cos(angle + Math.PI / 6) * ARROW_SIZE,
          arrowY - Math.sin(angle + Math.PI / 6) * ARROW_SIZE
        );
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    for (const node of this.nodeList) {
      if (node.x === undefined || node.y === undefined) continue;
      const isActive = !activeId || connectedIds.has(node.id) || node.id === activeId;
      const dimmed = activeId && !isActive;
      const label = resolveLabel(node);
      const radius = node.radius ?? 12;
      const baseColor = node.type === "project" ? projectColor(node) : workOrderColor(node);
      const pulse =
        isWorkOrderNode(node) && node.status === "building"
          ? 1 + Math.sin(now * 0.006 + seededFloat(node.id)) * 0.08
          : 1;
      const renderRadius = radius * pulse;
      const doneFade =
        isWorkOrderNode(node) && node.status === "done" ? 0.45 : 1;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.25 : doneFade;
      ctx.shadowBlur = node.type === "project" ? 16 : 10;
      ctx.shadowColor = withAlpha(baseColor, node.type === "project" ? 0.6 : 0.4);
      ctx.fillStyle = withAlpha(baseColor, node.type === "project" ? 0.75 : 0.65);
      ctx.strokeStyle = withAlpha(baseColor, node.type === "project" ? 0.9 : 0.7);
      ctx.lineWidth = node.type === "project" ? 2 : 1.4;
      ctx.beginPath();
      ctx.arc(node.x, node.y, renderRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (isWorkOrderNode(node) && node.status === "blocked") {
        ctx.strokeStyle = withAlpha(COLORS.workOrderBlocked, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, renderRadius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (node.type === "project" && node.escalationCount > 0) {
        const badgeRadius = 7;
        ctx.fillStyle = COLORS.workOrderBlocked;
        ctx.beginPath();
        ctx.arc(
          node.x + renderRadius * 0.6,
          node.y - renderRadius * 0.6,
          badgeRadius,
          0,
          Math.PI * 2
        );
        ctx.fill();
        if (node.escalationCount > 1) {
          ctx.fillStyle = "#fff";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            String(node.escalationCount),
            node.x + renderRadius * 0.6,
            node.y - renderRadius * 0.6
          );
        }
      }

      ctx.restore();

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.25 : doneFade * 0.9;
      ctx.fillStyle = node.type === "project" ? COLORS.label : COLORS.labelMuted;
      ctx.font = node.type === "project" ? "12px system-ui" : "11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, node.x, node.y + renderRadius + 6);
      ctx.restore();
    }

  }

  destroy(): void {
    this.simulation?.stop();
    this.simulation = null;
    this.nodes.clear();
    this.nodeList = [];
    this.links = [];
    this.dataNodeRefs.clear();
    this.canvas = null;
    this.ctx = null;
  }
}

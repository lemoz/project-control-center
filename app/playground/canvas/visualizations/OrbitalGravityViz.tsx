import type {
  ProjectNode,
  RunSummary,
  Visualization,
  VisualizationData,
  VisualizationNode,
  WorkOrderNode,
  WorkOrderStatus,
} from "../types";

type OrbitalMode = "projects" | "work-orders";

export type WorkOrderFilter = "active" | "all";

export type OrbitalGravityOptions = {
  mode?: OrbitalMode;
  projectId?: string | null;
  filter?: WorkOrderFilter;
  pinnedWorkOrderIds?: string[];
};

type OrbitalNode = ProjectNode | WorkOrderNode;

type Zone = {
  name: string;
  minR: number;
  maxR: number;
  color: string;
  label: string;
};

type Layout = {
  zones: Zone[];
  outerRadius: number;
  archiveRadius: number;
  innerOrbitRadius: number;
  focusRadius: number;
  sunRadius: number;
  scale: number;
};

type OrbitalNodeState = {
  id: string;
  angle: number;
  radius: number;
  targetRadius: number;
  angularVelocity: number;
  heat: number;
  baseRadius: number;
  radialOffset: number;
};

type Palette = {
  base: string;
  label: string;
  glow: string;
  stroke?: string;
};

type WorkOrderRunPhase = "waiting" | "testing" | "ai_review" | "you_review" | "building" | null;

type WorkOrderRing = "inner" | "middle" | "outer" | "archive";

const PROJECT_ZONES: Zone[] = [
  { name: "focus", minR: 0, maxR: 80, color: "#fef3c7", label: "Focus" },
  { name: "active", minR: 80, maxR: 180, color: "#fef9c3", label: "Active" },
  { name: "ready", minR: 180, maxR: 280, color: "#f0fdf4", label: "Ready" },
  { name: "idle", minR: 280, maxR: 400, color: "#f8fafc", label: "Idle" },
];

const WORK_ORDER_ZONES: Zone[] = [
  {
    name: "inner",
    minR: 40,
    maxR: 140,
    color: "#fef3c7",
    label: "Urgent",
  },
  {
    name: "middle",
    minR: 140,
    maxR: 260,
    color: "#dcfce7",
    label: "Active",
  },
  {
    name: "outer",
    minR: 260,
    maxR: 400,
    color: "#f8fafc",
    label: "Backlog",
  },
];

const BASE_OUTER_RADIUS = 400;
const ARCHIVE_EXTENSION = 80;
const BASE_FOCUS_RADIUS = 34;
const BASE_SUN_RADIUS = 18;
const LABEL_OFFSET = 12;
const RADIAL_JITTER = 12;
const COLLISION_PADDING = 4;
const COLLISION_ITERATIONS = 3;

const BASE_ORBIT_SPEED = 0.016;
const MIN_ORBIT_SPEED = 0.005;
const MAX_ORBIT_SPEED = 0.05;
const HEAT_GAIN_RATE = 1.4;
const HEAT_DECAY_RATE = 0.45;
const RADIUS_SMOOTH_RATE = 2.6;
const FOCUS_DURATION_MS = 7000;
const FOCUS_FADE_MS = 1800;

const COLORS = {
  active: "#60a5fa",
  testing: "#22d3ee",
  reviewing: "#a855f7",
  waiting: "#fbbf24",
  blocked: "#f87171",
  parked: "#94a3b8",
  idle: "#64748b",
  ready: "#22c55e",
  backlog: "#64748b",
  done: "#94a3b8",
};

const WORK_ORDER_BASE_HEAT: Record<WorkOrderStatus, number> = {
  building: 0.9,
  ai_review: 0.88,
  you_review: 0.88,
  ready: 0.6,
  blocked: 0.78,
  backlog: 0.28,
  done: 0.12,
  parked: 0.12,
};

const WORK_ORDER_STATUS_COLORS: Record<WorkOrderStatus, string> = {
  building: COLORS.testing,
  ai_review: COLORS.reviewing,
  you_review: COLORS.reviewing,
  ready: COLORS.ready,
  blocked: COLORS.blocked,
  backlog: COLORS.backlog,
  done: COLORS.done,
  parked: COLORS.parked,
};

const ACTIVE_WORK_ORDER_FILTER_STATUSES = new Set<WorkOrderStatus>([
  "building",
  "ai_review",
  "you_review",
  "ready",
  "blocked",
]);

const ARCHIVE_WORK_ORDER_STATUSES = new Set<WorkOrderStatus>(["done", "parked"]);

const BACKLOG_WORK_ORDER_STATUSES = new Set<WorkOrderStatus>(["backlog"]);

const TERMINAL_RUN_STATUSES = new Set<RunSummary["status"]>([
  "merged",
  "failed",
  "canceled",
  "baseline_failed",
  "merge_conflict",
]);

const MAX_BACKLOG_NODES = 20;
const MAX_ARCHIVE_NODES = 20;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function smoothFactor(delta: number, rate: number): number {
  return 1 - Math.exp(-rate * delta);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededFloat(value: string): number {
  const hash = hashString(value);
  return (hash % 1000) / 1000;
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
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function isHexColor(value: string | null | undefined): value is string {
  return typeof value === "string" && /^#?[0-9a-fA-F]{6}$/.test(value);
}

function normalizeHexColor(value: string | null | undefined, fallback: string): string {
  if (!isHexColor(value)) return fallback;
  return value.startsWith("#") ? value : `#${value}`;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function lightenHex(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const weight = clamp(amount, 0, 1);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * weight);
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

function radiusFromConsumption(consumptionRate: number): number {
  const scaled = Math.log10(Math.max(1, consumptionRate));
  const radius = 10 + scaled * 8;
  return clamp(radius, 10, 30);
}

function workOrderBaseRadius(node: WorkOrderNode): number {
  if (typeof node.estimateHours === "number" && Number.isFinite(node.estimateHours)) {
    const estimate = Math.max(0, node.estimateHours);
    if (estimate > 0) {
      return clamp(10 + Math.sqrt(estimate) * 4, 10, 28);
    }
  }
  const priority = clamp(node.priority ?? 3, 1, 5);
  return clamp(10 + (6 - priority) * 3, 10, 26);
}

function workOrderSizeScale(status: WorkOrderStatus): number {
  if (ARCHIVE_WORK_ORDER_STATUSES.has(status)) return 0.78;
  if (BACKLOG_WORK_ORDER_STATUSES.has(status)) return 0.82;
  if (status === "ready") return 0.92;
  return 1;
}

function workOrderSpeedDamp(status: WorkOrderStatus): number {
  if (ARCHIVE_WORK_ORDER_STATUSES.has(status)) return 0.45;
  if (BACKLOG_WORK_ORDER_STATUSES.has(status)) return 0.55;
  if (status === "blocked") return 0.6;
  if (status === "ready") return 0.7;
  return 1;
}

function isProjectNode(node: OrbitalNode): node is ProjectNode {
  return node.type === "project";
}

function isWorkOrderNode(node: OrbitalNode): node is WorkOrderNode {
  return node.type === "work_order";
}

function targetHeatForProject(node: ProjectNode): number {
  let heat = clamp(node.activityLevel, 0, 1);
  if (node.isActive) heat = Math.max(heat, 0.65);
  if (node.needsHuman || node.status === "blocked") heat = Math.max(heat, 0.78);
  if (node.activePhase === "testing") heat = Math.max(heat, 0.7);
  if (node.activePhase === "reviewing") heat = Math.max(heat, 0.62);
  if (node.activePhase === "waiting") heat = Math.max(heat, 0.55);
  if (node.status === "parked") heat = Math.min(heat, 0.2);
  return clamp(heat, 0, 1);
}

function resolveWorkOrderRunPhase(runs: RunSummary[]): WorkOrderRunPhase {
  if (!runs.length) return null;
  if (runs.some((run) => run.status === "waiting_for_input")) return "waiting";
  if (runs.some((run) => run.status === "testing")) return "testing";
  if (runs.some((run) => run.status === "ai_review")) return "ai_review";
  if (runs.some((run) => run.status === "you_review")) return "you_review";
  if (runs.some((run) => run.status === "building" || run.status === "queued")) {
    return "building";
  }
  return "building";
}

function targetHeatForWorkOrder(
  node: WorkOrderNode,
  runPhase: WorkOrderRunPhase | null
): number {
  let heat = WORK_ORDER_BASE_HEAT[node.status] ?? 0.5;
  heat += node.activityLevel * 0.2;
  if (runPhase === "waiting") {
    heat = Math.max(heat, 0.9);
  } else if (runPhase === "testing") {
    heat = Math.max(heat, 0.84);
  } else if (runPhase === "ai_review") {
    heat = Math.max(heat, 0.88);
  } else if (runPhase === "you_review") {
    heat = Math.max(heat, 0.75);
  } else if (runPhase === "building") {
    heat = Math.max(heat, 0.82);
  }
  return clamp(heat, 0, 1);
}

function paletteForProject(node: ProjectNode): Palette {
  if (node.needsHuman || node.status === "blocked") {
    return { base: COLORS.blocked, label: "#fecaca", glow: "#fca5a5" };
  }
  if (node.status === "parked") {
    return { base: COLORS.parked, label: "#e2e8f0", glow: "#cbd5f5" };
  }
  if (!node.isActive) {
    return { base: COLORS.idle, label: "#cbd5f5", glow: "#94a3b8" };
  }
  if (node.activePhase === "testing") {
    return { base: COLORS.testing, label: "#cffafe", glow: "#67e8f9" };
  }
  if (node.activePhase === "reviewing") {
    return { base: COLORS.reviewing, label: "#e9d5ff", glow: "#c084fc" };
  }
  if (node.activePhase === "waiting") {
    return { base: COLORS.waiting, label: "#fef3c7", glow: "#fde68a" };
  }
  return { base: COLORS.active, label: "#dbeafe", glow: "#93c5fd" };
}

function statusAccentColorForWorkOrder(
  node: WorkOrderNode,
  runPhase: WorkOrderRunPhase | null
): string {
  if (runPhase === "waiting") return COLORS.waiting;
  if (runPhase === "testing") return COLORS.testing;
  if (runPhase === "ai_review" || runPhase === "you_review") return COLORS.reviewing;
  if (runPhase === "building") return WORK_ORDER_STATUS_COLORS.building;
  return WORK_ORDER_STATUS_COLORS[node.status] ?? COLORS.backlog;
}

function paletteForWorkOrder(
  node: WorkOrderNode,
  runPhase: WorkOrderRunPhase | null
): Palette {
  const accent = statusAccentColorForWorkOrder(node, runPhase);
  const base = normalizeHexColor(node.track?.color ?? null, accent);
  const label = lightenHex(base, 0.55);
  return {
    base,
    label,
    glow: accent,
    stroke: accent,
  };
}

function computeProjectOrbitRadius(node: ProjectNode, heat: number, layout: Layout): number {
  const outerTarget =
    node.status === "parked" || (!node.isActive && node.activityLevel < 0.2)
      ? layout.archiveRadius
      : layout.outerRadius;
  return lerp(outerTarget, layout.innerOrbitRadius, heat);
}

function workOrderRingForStatus(
  status: WorkOrderStatus,
  runPhase: WorkOrderRunPhase | null
): WorkOrderRing {
  // Done and parked always go to archive, regardless of runPhase
  if (status === "done" || status === "parked") return "archive";
  if (runPhase) return "inner";
  // Only active agent work goes in "Urgent" — you_review waits on human, not system
  if (status === "building" || status === "ai_review") return "inner";
  if (status === "ready" || status === "blocked" || status === "you_review") return "middle";
  if (status === "backlog") return "outer";
  return "archive";
}

function computeWorkOrderOrbitRadius(
  node: WorkOrderNode,
  heat: number,
  layout: Layout,
  runPhase: WorkOrderRunPhase | null
): number {
  const ring = workOrderRingForStatus(node.status, runPhase);
  if (ring === "archive") return layout.archiveRadius;
  const index = ring === "inner" ? 0 : ring === "middle" ? 1 : 2;
  const zone = layout.zones[index] ?? layout.zones[layout.zones.length - 1];
  return lerp(zone.maxR, zone.minR, clamp(heat, 0, 1));
}

function sortByRecency(nodes: WorkOrderNode[]): WorkOrderNode[] {
  return nodes.slice().sort((a, b) => {
    const aTime = a.lastActivity?.getTime() ?? 0;
    const bTime = b.lastActivity?.getTime() ?? 0;
    return bTime - aTime;
  });
}

export function selectWorkOrderNodes(params: {
  nodes: WorkOrderNode[];
  filter: WorkOrderFilter;
  projectId?: string | null;
  maxBacklog?: number;
  maxArchive?: number;
  includeIds?: string[];
}): WorkOrderNode[] {
  const {
    nodes,
    filter,
    projectId = null,
    maxBacklog = MAX_BACKLOG_NODES,
    maxArchive = MAX_ARCHIVE_NODES,
    includeIds = [],
  } = params;

  let filtered = nodes;
  if (projectId) {
    filtered = filtered.filter((node) => node.projectId === projectId);
  }

  const includeIdSet = new Set(includeIds);
  const appendPinnedNodes = (selected: WorkOrderNode[]) => {
    if (includeIdSet.size === 0) return selected;
    const seen = new Set(selected.map((node) => node.id));
    for (const node of filtered) {
      if (!includeIdSet.has(node.id) || seen.has(node.id)) continue;
      selected.push(node);
      seen.add(node.id);
    }
    return selected;
  };

  if (filter === "active") {
    const activeNodes = filtered.filter((node) =>
      ACTIVE_WORK_ORDER_FILTER_STATUSES.has(node.status)
    );
    return appendPinnedNodes(activeNodes);
  }

  const backlogNodes = filtered.filter((node) => BACKLOG_WORK_ORDER_STATUSES.has(node.status));
  const archiveNodes = filtered.filter((node) => ARCHIVE_WORK_ORDER_STATUSES.has(node.status));

  const backlogIds = new Set(
    sortByRecency(backlogNodes).slice(0, Math.max(0, maxBacklog)).map((node) => node.id)
  );
  const archiveIds = new Set(
    sortByRecency(archiveNodes).slice(0, Math.max(0, maxArchive)).map((node) => node.id)
  );

  const selected = filtered.filter((node) => {
    if (BACKLOG_WORK_ORDER_STATUSES.has(node.status)) {
      return backlogIds.has(node.id);
    }
    if (ARCHIVE_WORK_ORDER_STATUSES.has(node.status)) {
      return archiveIds.has(node.id);
    }
    return true;
  });

  return appendPinnedNodes(selected);
}

function buildRunMap(
  runsByProject: VisualizationData["runsByProject"]
): Map<string, RunSummary[]> {
  const map = new Map<string, RunSummary[]>();
  if (!runsByProject) return map;
  for (const [projectId, runs] of Object.entries(runsByProject)) {
    for (const run of runs) {
      const key = `${projectId}::${run.work_order_id}`;
      const existing = map.get(key);
      if (existing) {
        existing.push(run);
      } else {
        map.set(key, [run]);
      }
    }
  }
  return map;
}

export class OrbitalGravityVisualization implements Visualization {
  id = "orbital_gravity";
  name = "Orbital Gravity";
  description = "Attention gravity view with orbital drift and focus pull.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };
  private nodeStates = new Map<string, OrbitalNodeState>();
  private runPhaseByNode = new Map<string, WorkOrderRunPhase>();
  private lastFrame = 0;
  private focusedId: string | null = null;
  private focusUntil = 0;
  private hoveredId: string | null = null;
  private mode: OrbitalMode;
  private projectId: string | null;
  private workOrderFilter: WorkOrderFilter;
  private pinnedWorkOrderIds: Set<string>;
  private visibleNodes: OrbitalNode[] = [];

  constructor(options: OrbitalGravityOptions = {}) {
    this.mode = options.mode ?? "projects";
    this.projectId = options.projectId ?? null;
    this.workOrderFilter =
      options.filter ?? (this.mode === "work-orders" ? "active" : "all");
    this.pinnedWorkOrderIds = new Set(options.pinnedWorkOrderIds ?? []);
  }

  setWorkOrderFilter(filter: WorkOrderFilter): void {
    if (this.workOrderFilter === filter) return;
    this.workOrderFilter = filter;
    this.update(this.data);
  }

  setProjectId(projectId: string | null): void {
    if (this.projectId === projectId) return;
    this.projectId = projectId;
    this.update(this.data);
  }

  setPinnedWorkOrderIds(ids: string[]): void {
    const next = new Set(ids.filter(Boolean));
    if (next.size === this.pinnedWorkOrderIds.size) {
      let unchanged = true;
      for (const id of next) {
        if (!this.pinnedWorkOrderIds.has(id)) {
          unchanged = false;
          break;
        }
      }
      if (unchanged) return;
    }
    this.pinnedWorkOrderIds = next;
    this.update(this.data);
  }

  init(canvas: HTMLCanvasElement, data: VisualizationData): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.lastFrame = performance.now();
    this.update(data);
  }

  update(data: VisualizationData): void {
    this.data = data;
    const layout = this.getLayout();
    const seen = new Set<string>();
    const nodes = this.resolveNodes(data);
    this.visibleNodes = nodes;

    if (this.mode === "work-orders") {
      const runMap = buildRunMap(data.runsByProject ?? undefined);
      this.runPhaseByNode.clear();
      for (const node of nodes) {
        if (!isWorkOrderNode(node)) continue;
        const runs = runMap.get(node.id) ?? [];
        const activeRuns = runs.filter(
          (run) => !TERMINAL_RUN_STATUSES.has(run.status)
        );
        this.runPhaseByNode.set(node.id, resolveWorkOrderRunPhase(activeRuns));
      }
    } else {
      this.runPhaseByNode.clear();
    }

    for (const node of nodes) {
      const baseRadius = isProjectNode(node)
        ? radiusFromConsumption(node.consumptionRate)
        : workOrderBaseRadius(node);
      const runPhase = isWorkOrderNode(node)
        ? this.runPhaseByNode.get(node.id) ?? null
        : null;
      const targetHeat = isProjectNode(node)
        ? targetHeatForProject(node)
        : targetHeatForWorkOrder(node, runPhase);
      const radialOffset = (seededFloat(`${node.id}-radius`) - 0.5) * RADIAL_JITTER * 2;
      const initialRadius =
        (isProjectNode(node)
          ? computeProjectOrbitRadius(node, targetHeat, layout)
          : computeWorkOrderOrbitRadius(node, targetHeat, layout, runPhase)) +
        radialOffset;
      const existing = this.nodeStates.get(node.id);
      if (existing) {
        existing.baseRadius = baseRadius;
      } else {
        this.nodeStates.set(node.id, {
          id: node.id,
          angle: seededFloat(`${node.id}-angle`) * Math.PI * 2,
          radius: initialRadius,
          targetRadius: initialRadius,
          angularVelocity: BASE_ORBIT_SPEED,
          heat: targetHeat,
          baseRadius,
          radialOffset,
        });
      }
      seen.add(node.id);
    }

    for (const id of this.nodeStates.keys()) {
      if (!seen.has(id)) this.nodeStates.delete(id);
    }

    if (this.focusedId && !seen.has(this.focusedId)) {
      this.focusedId = null;
    }
    if (this.hoveredId && !seen.has(this.hoveredId)) {
      this.hoveredId = null;
    }
  }

  onNodeClick(node: VisualizationNode | null): void {
    if (!node) {
      this.focusedId = null;
      return;
    }
    if (this.mode === "projects" && node.type !== "project") {
      this.focusedId = null;
      return;
    }
    if (this.mode === "work-orders" && node.type !== "work_order") {
      this.focusedId = null;
      return;
    }
    this.focusedId = node.id;
    this.focusUntil = performance.now() + FOCUS_DURATION_MS;
  }

  onNodeHover(node: VisualizationNode | null): void {
    if (!node) {
      this.hoveredId = null;
      return;
    }
    if (this.mode === "projects" && node.type === "project") {
      this.hoveredId = node.id;
      return;
    }
    if (this.mode === "work-orders" && node.type === "work_order") {
      this.hoveredId = node.id;
      return;
    }
    this.hoveredId = null;
  }

  render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.focusedId && now >= this.focusUntil) {
      this.focusedId = null;
    }

    const layout = this.getLayout();
    this.drawZones(ctx, layout);
    this.drawSun(ctx, layout);

    // First pass: calculate positions and sizes
    const nodeData: Array<{
      node: OrbitalNode;
      state: OrbitalNodeState;
      runPhase: WorkOrderRunPhase | null;
      focusBlend: number;
    }> = [];

    for (const node of this.visibleNodes) {
      const state = this.nodeStates.get(node.id);
      if (!state) continue;

      const runPhase = isWorkOrderNode(node)
        ? this.runPhaseByNode.get(node.id) ?? null
        : null;
      const targetHeat = isProjectNode(node)
        ? targetHeatForProject(node)
        : targetHeatForWorkOrder(node, runPhase);
      const heatRate = targetHeat > state.heat ? HEAT_GAIN_RATE : HEAT_DECAY_RATE;
      state.heat = lerp(state.heat, targetHeat, smoothFactor(delta, heatRate));

      const baseTargetRadius =
        (isProjectNode(node)
          ? computeProjectOrbitRadius(node, state.heat, layout)
          : computeWorkOrderOrbitRadius(node, state.heat, layout, runPhase)) +
        state.radialOffset;
      let focusBlend = 0;
      if (this.focusedId === node.id && now < this.focusUntil) {
        const remaining = this.focusUntil - now;
        focusBlend = remaining < FOCUS_FADE_MS ? remaining / FOCUS_FADE_MS : 1;
      }
      const desiredRadius = lerp(baseTargetRadius, layout.focusRadius, focusBlend);
      state.targetRadius = desiredRadius;
      state.radius = lerp(state.radius, state.targetRadius, smoothFactor(delta, RADIUS_SMOOTH_RATE));

      // Only orbit if agent is actively working, not waiting on human
      const isAgentWorking = runPhase === "building" || runPhase === "testing" || runPhase === "ai_review";
      if (isAgentWorking) {
        const speedFactor = layout.outerRadius / Math.max(state.radius, layout.focusRadius);
        const focusSpeedDamp = lerp(1, 0.4, focusBlend);
        const speedDamp = isWorkOrderNode(node) ? workOrderSpeedDamp(node.status) : 1;
        state.angularVelocity = clamp(
          BASE_ORBIT_SPEED * speedFactor * focusSpeedDamp * speedDamp,
          MIN_ORBIT_SPEED * speedDamp,
          MAX_ORBIT_SPEED
        );
        state.angle += state.angularVelocity * delta;
      }

      const hoverBoost = this.hoveredId === node.id ? 0.12 : 0;
      const focusBoostSize = focusBlend > 0 ? 0.18 : 0;
      const sizeScale = isWorkOrderNode(node) ? workOrderSizeScale(node.status) : 1;
      const size =
        state.baseRadius * sizeScale * (1 + state.heat * 0.25 + hoverBoost + focusBoostSize);

      node.x = Math.cos(state.angle) * state.radius;
      node.y = Math.sin(state.angle) * state.radius;
      node.radius = size;

      nodeData.push({ node, state, runPhase, focusBlend });
    }

    // Second pass: collision avoidance (push overlapping nodes apart angularly)
    for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
      for (let i = 0; i < nodeData.length; i++) {
        for (let j = i + 1; j < nodeData.length; j++) {
          const a = nodeData[i];
          const b = nodeData[j];
          const dx = (b.node.x ?? 0) - (a.node.x ?? 0);
          const dy = (b.node.y ?? 0) - (a.node.y ?? 0);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = (a.node.radius ?? 10) + (b.node.radius ?? 10) + COLLISION_PADDING;

          if (dist < minDist && dist > 0) {
            // Push apart by adjusting angles
            const overlap = (minDist - dist) / 2;
            const pushAngle = overlap / Math.max(a.state.radius, b.state.radius, 1);

            // Determine push direction based on angle difference
            const angleDiff = b.state.angle - a.state.angle;
            const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));

            if (normalizedDiff >= 0) {
              a.state.angle -= pushAngle * 0.5;
              b.state.angle += pushAngle * 0.5;
            } else {
              a.state.angle += pushAngle * 0.5;
              b.state.angle -= pushAngle * 0.5;
            }

            // Recalculate positions
            a.node.x = Math.cos(a.state.angle) * a.state.radius;
            a.node.y = Math.sin(a.state.angle) * a.state.radius;
            b.node.x = Math.cos(b.state.angle) * b.state.radius;
            b.node.y = Math.sin(b.state.angle) * b.state.radius;
          }
        }
      }
    }

    // Third pass: render all nodes
    for (const { node, state, runPhase, focusBlend } of nodeData) {
      const orbitX = node.x ?? 0;
      const orbitY = node.y ?? 0;
      const size = node.radius ?? 10;

      const palette = isProjectNode(node)
        ? paletteForProject(node)
        : paletteForWorkOrder(node, runPhase);
      const idleDimming = isProjectNode(node) ? (node.isActive ? 1 : 0.7) : 1;
      const glow = clamp(0.25 + state.heat * 0.65, 0.2, 0.95) * idleDimming;
      const fillAlpha = clamp(0.28 + state.heat * 0.5, 0.2, 0.85) * idleDimming;
      const strokeAlpha = clamp(0.35 + state.heat * 0.45, 0.25, 0.9) * idleDimming;
      const strokeColor = palette.stroke ?? palette.base;

      ctx.save();
      ctx.shadowBlur = 10 + state.heat * 24;
      ctx.shadowColor = withAlpha(palette.glow, glow * 0.6);
      ctx.fillStyle = withAlpha(palette.base, fillAlpha);
      ctx.strokeStyle = withAlpha(strokeColor, strokeAlpha);
      ctx.lineWidth = isProjectNode(node) && node.isActive ? 1.6 : 1.2;
      if (isWorkOrderNode(node) && node.status === "blocked") {
        ctx.lineWidth = 1.6;
      }
      ctx.beginPath();
      ctx.arc(orbitX, orbitY, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Notification dot for items needing human attention
      const needsHumanAttention =
        (isProjectNode(node) && node.needsHuman) ||
        (isWorkOrderNode(node) &&
          (node.status === "you_review" ||
            node.status === "blocked" ||
            runPhase === "waiting"));

      if (needsHumanAttention) {
        const dotRadius = 5;
        const dotX = orbitX + size * 0.6;
        const dotY = orbitY - size * 0.6;

        // Dot color: orange for review, red for blocked/escalation
        const isBlocked = isWorkOrderNode(node) && node.status === "blocked";
        const hasEscalation = isProjectNode(node) && node.escalationCount > 0;
        const dotColor = isBlocked || hasEscalation ? "#f87171" : "#fbbf24";

        ctx.save();
        ctx.fillStyle = dotColor;
        ctx.shadowBlur = 8;
        ctx.shadowColor = dotColor;
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Show count for escalations
        if (isProjectNode(node) && node.escalationCount > 1) {
          ctx.fillStyle = "#fff";
          ctx.font = "9px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(node.escalationCount), dotX, dotY);
        }
      }

      const showLabel =
        isProjectNode(node) ||
        this.hoveredId === node.id ||
        this.focusedId === node.id ||
        state.heat >= 0.7;

      if (showLabel) {
        const labelAlpha = clamp(0.25 + state.heat * 0.6, 0.2, 0.9) * idleDimming;
        ctx.fillStyle = withAlpha(palette.label, labelAlpha);
        ctx.font = isWorkOrderNode(node) ? "11px system-ui" : "12px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(node.label, orbitX, orbitY + size + LABEL_OFFSET);
      }
    }
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this.nodeStates.clear();
    this.runPhaseByNode.clear();
    this.visibleNodes = [];
  }

  private resolveNodes(data: VisualizationData): OrbitalNode[] {
    if (this.mode === "work-orders") {
      return selectWorkOrderNodes({
        nodes: data.workOrderNodes ?? [],
        filter: this.workOrderFilter,
        projectId: this.projectId,
        includeIds: Array.from(this.pinnedWorkOrderIds),
      });
    }
    return data.nodes;
  }

  private getLayout(): Layout {
    const rect = this.canvas?.getBoundingClientRect();
    const minDimension = rect ? Math.min(rect.width, rect.height) : 520;
    const maxRadius = minDimension * 0.45;
    const scale = maxRadius / BASE_OUTER_RADIUS;
    const baseZones = this.mode === "work-orders" ? WORK_ORDER_ZONES : PROJECT_ZONES;
    const zones = baseZones.map((zone) => ({
      ...zone,
      minR: zone.minR * scale,
      maxR: zone.maxR * scale,
    }));
    const outerRadius = zones[zones.length - 1].maxR;
    const archiveRadius = outerRadius + ARCHIVE_EXTENSION * scale;
    const anchorIndex = this.mode === "work-orders" ? 0 : 1;
    const anchorZone = zones[anchorIndex] ?? zones[0];
    const innerOrbitRadius = (anchorZone.minR + anchorZone.maxR) / 2;
    const focusRadius = Math.max(anchorZone.minR * 0.5, BASE_FOCUS_RADIUS * scale);
    const sunRadius = Math.max(BASE_SUN_RADIUS * scale, focusRadius * 0.45);
    return {
      zones,
      outerRadius,
      archiveRadius,
      innerOrbitRadius,
      focusRadius,
      sunRadius,
      scale,
    };
  }

  private drawZones(ctx: CanvasRenderingContext2D, layout: Layout): void {
    for (const zone of layout.zones) {
      ctx.save();
      ctx.fillStyle = withAlpha(zone.color, 0.05);
      ctx.beginPath();
      ctx.arc(0, 0, zone.maxR, 0, Math.PI * 2);
      ctx.arc(0, 0, zone.minR, 0, Math.PI * 2, true);
      ctx.fill();

      ctx.strokeStyle = withAlpha(zone.color, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, zone.maxR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = withAlpha(zone.color, 0.55);
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(zone.label, 0, -zone.maxR + 14);
    }

    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, layout.archiveRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (this.mode === "work-orders") {
      ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Archive", 0, -layout.archiveRadius + 14);
    }
  }

  private drawSun(ctx: CanvasRenderingContext2D, layout: Layout): void {
    const gradient = ctx.createRadialGradient(
      0,
      0,
      0,
      0,
      0,
      layout.sunRadius * 2.6
    );
    gradient.addColorStop(0, "rgba(255, 247, 214, 0.95)");
    gradient.addColorStop(0.6, "rgba(254, 215, 140, 0.4)");
    gradient.addColorStop(1, "rgba(254, 215, 140, 0.05)");

    ctx.save();
    ctx.shadowBlur = layout.sunRadius * 2.4;
    ctx.shadowColor = "rgba(254, 215, 140, 0.5)";
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, layout.sunRadius * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(255, 245, 220, 0.85)";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("attention", 0, layout.sunRadius + 16);
  }
}

import type { ProjectNode, RunStatus, RunSummary, Visualization, VisualizationData } from "../types";

type StageId = "backlog" | "ready" | "building" | "review" | "done";

type RiverStage = {
  id: StageId;
  label: string;
  start: number;
  width: number;
  color: string;
  accent: string;
};

type StageBounds = {
  startX: number;
  endX: number;
  centerX: number;
};

type LaneLayout = {
  node: ProjectNode;
  index: number;
  centerY: number;
  top: number;
  bottom: number;
};

type Layout = {
  riverLeft: number;
  riverRight: number;
  riverTop: number;
  riverBottom: number;
  labelX: number;
  labelWidth: number;
  lanes: LaneLayout[];
  stageBounds: Record<StageId, StageBounds>;
};

type BubbleType = "run" | "wo";

type BubblePlan = {
  id: string;
  projectId: string;
  projectName: string;
  type: BubbleType;
  stageId: StageId;
  stageLabel: string;
  status: RunStatus | "backlog" | "ready";
  run: RunSummary | null;
  workOrderId: string | null;
  targetX: number;
  targetY: number;
  radius: number;
  targetOpacity: number;
  isActive: boolean;
  isTerminal: boolean;
  isFailed: boolean;
  isSuccess: boolean;
};

type RiverBubbleState = BubblePlan & {
  x: number;
  y: number;
  opacity: number;
  bobSeed: number;
  driftSeed: number;
};

export type RiverBubbleDetails = {
  bubbleId: string;
  runId: string;
  projectId: string;
  projectName: string;
  status: RunStatus;
  stageId: StageId;
  stageLabel: string;
  workOrderId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  escalation: string | null;
};

const STAGES: RiverStage[] = [
  { id: "backlog", label: "Backlog", color: "#18202c", accent: "#5b647a", start: 0, width: 0.15 },
  { id: "ready", label: "Ready", color: "#133028", accent: "#3fb38f", start: 0.15, width: 0.15 },
  { id: "building", label: "Building", color: "#142639", accent: "#4f7cff", start: 0.3, width: 0.25 },
  { id: "review", label: "Review", color: "#182e36", accent: "#38bdf8", start: 0.55, width: 0.2 },
  { id: "done", label: "Done", color: "#142b22", accent: "#4ade80", start: 0.75, width: 0.25 },
];

const RUN_STAGE_MAP: Record<RunStatus, StageId> = {
  queued: "ready",
  baseline_failed: "done",
  building: "building",
  waiting_for_input: "review",
  security_hold: "review",
  ai_review: "review",
  testing: "review",
  you_review: "review",
  merged: "done",
  merge_conflict: "done",
  failed: "done",
  canceled: "done",
};

const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "merged",
  "failed",
  "canceled",
  "baseline_failed",
  "merge_conflict",
]);

const FAILURE_STATUSES = new Set<RunStatus>([
  "failed",
  "canceled",
  "baseline_failed",
  "merge_conflict",
]);

const SUCCESS_STATUSES = new Set<RunStatus>(["merged"]);

const RIVER_WIDTH = 780;
const LANE_HEIGHT = 72;
const LANE_GAP = 26;
const LABEL_WIDTH = 160;
const LABEL_OFFSET = 120;
const BUBBLE_STACK_SPACING = 18;
const ACTIVE_TARGET_PADDING = 26;
const DONE_DRIFT = 140;
const DONE_RETENTION_MS = 45 * 60 * 1000;
const MAX_COMPLETED_RUNS = 6;
const MAX_IDLE_WOS = 4;

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

function stageBoundsMap(riverLeft: number): Record<StageId, StageBounds> {
  const bounds = {} as Record<StageId, StageBounds>;
  for (const stage of STAGES) {
    const startX = riverLeft + stage.start * RIVER_WIDTH;
    const endX = startX + stage.width * RIVER_WIDTH;
    bounds[stage.id] = {
      startX,
      endX,
      centerX: (startX + endX) / 2,
    };
  }
  return bounds;
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function runTimestamp(run: RunSummary): number {
  return (
    parseDate(run.finished_at) ??
    parseDate(run.started_at) ??
    parseDate(run.created_at) ??
    Date.now()
  );
}

function bubbleColor(state: RiverBubbleState): string {
  if (state.isFailed) return "#f87171";
  if (state.isSuccess) return "#4ade80";
  if (state.type === "wo") return "#94a3b8";
  if (state.stageId === "building") return "#38bdf8";
  if (state.stageId === "review") return "#22d3ee";
  if (state.stageId === "ready") return "#5eead4";
  if (state.stageId === "backlog") return "#94a3b8";
  return "#60a5fa";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export class TimelineRiverVisualization implements Visualization {
  id = "timeline_river";
  name = "Timeline River";
  description = "Flowing timeline of runs moving through stages.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };
  private bubbleStates = new Map<string, RiverBubbleState>();
  private layout: Layout | null = null;
  private lastFrame = 0;
  private selectedBubbleId: string | null = null;

  init(canvas: HTMLCanvasElement, data: VisualizationData): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.lastFrame = performance.now();
    this.update(data);
  }

  update(data: VisualizationData): void {
    this.data = data;
    this.layout = this.computeLayout(data.nodes);
    if (this.layout) {
      for (const lane of this.layout.lanes) {
        lane.node.x = this.layout.labelX + 18;
        lane.node.y = lane.centerY;
        lane.node.radius = 10;
      }
    }
    this.syncBubbles();
  }

  private computeLayout(nodes: ProjectNode[]): Layout {
    const ordered = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
    const laneCount = Math.max(1, ordered.length);
    const totalHeight = laneCount * LANE_HEIGHT + (laneCount - 1) * LANE_GAP;
    const riverLeft = -RIVER_WIDTH / 2;
    const riverRight = riverLeft + RIVER_WIDTH;
    const riverTop = -totalHeight / 2;
    const riverBottom = riverTop + totalHeight;
    const labelX = riverLeft - LABEL_OFFSET;

    const lanes = ordered.map((node, index) => {
      const top = riverTop + index * (LANE_HEIGHT + LANE_GAP);
      const centerY = top + LANE_HEIGHT / 2;
      return { node, index, centerY, top, bottom: top + LANE_HEIGHT };
    });

    return {
      riverLeft,
      riverRight,
      riverTop,
      riverBottom,
      labelX,
      labelWidth: LABEL_WIDTH,
      lanes,
      stageBounds: stageBoundsMap(riverLeft),
    };
  }

  private syncBubbles(): void {
    if (!this.layout) return;
    const runsByProject = this.data.runsByProject ?? {};
    const plans: BubblePlan[] = [];
    const laneByProject = new Map<string, LaneLayout>();
    for (const lane of this.layout.lanes) {
      laneByProject.set(lane.node.id, lane);
    }

    for (const lane of this.layout.lanes) {
      const node = lane.node;
      const runs = runsByProject[node.id] ?? [];
      const activeRuns = runs.filter((run) => !TERMINAL_RUN_STATUSES.has(run.status));
      const completedRuns = runs
        .filter((run) => TERMINAL_RUN_STATUSES.has(run.status))
        .filter((run) => Date.now() - runTimestamp(run) <= DONE_RETENTION_MS)
        .sort((a, b) => runTimestamp(b) - runTimestamp(a))
        .slice(0, MAX_COMPLETED_RUNS);

      const visibleRuns = [...activeRuns, ...completedRuns];
      for (const run of visibleRuns) {
        const stageId = RUN_STAGE_MAP[run.status] ?? "building";
        const stageLabel = STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
        const stage = this.layout.stageBounds[stageId];
        const isTerminal = TERMINAL_RUN_STATUSES.has(run.status);
        const isFailed = FAILURE_STATUSES.has(run.status);
        const isSuccess = SUCCESS_STATUSES.has(run.status);
        const isActive = !isTerminal;
        const seed = seededFloat(`${node.id}-${run.id}`);
        const stageSpan = stage.endX - stage.startX;
        const offsetX = (seed - 0.5) * stageSpan * 0.2;
        const targetX = isTerminal
          ? this.layout.riverRight + DONE_DRIFT
          : stage.endX - ACTIVE_TARGET_PADDING + offsetX;

        plans.push({
          id: `run-${node.id}-${run.id}`,
          projectId: node.id,
          projectName: node.name,
          type: "run",
          stageId,
          stageLabel,
          status: run.status,
          run,
          workOrderId: run.work_order_id,
          targetX,
          targetY: lane.centerY,
          radius: isActive ? 12 : 10,
          targetOpacity: isTerminal ? 0 : 0.9,
          isActive,
          isTerminal,
          isFailed,
          isSuccess,
        });
      }

      const idleCount = Math.min(MAX_IDLE_WOS, node.workOrders.ready + node.workOrders.blocked);
      const backlogCount = Math.min(2, Math.floor(idleCount / 2));
      const readyCount = idleCount - backlogCount;
      for (let i = 0; i < backlogCount; i += 1) {
        const stageId: StageId = "backlog";
        const stageLabel = STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
        const seed = seededFloat(`${node.id}-backlog-${i}`);
        const stage = this.layout.stageBounds[stageId];
        const stageSpan = stage.endX - stage.startX;
        const targetX = stage.startX + stageSpan * (0.2 + seed * 0.5);
        plans.push({
          id: `wo-${node.id}-backlog-${i}`,
          projectId: node.id,
          projectName: node.name,
          type: "wo",
          stageId,
          stageLabel,
          status: "backlog",
          run: null,
          workOrderId: null,
          targetX,
          targetY: lane.centerY,
          radius: 8,
          targetOpacity: 0.6,
          isActive: false,
          isTerminal: false,
          isFailed: false,
          isSuccess: false,
        });
      }

      for (let i = 0; i < readyCount; i += 1) {
        const stageId: StageId = "ready";
        const stageLabel = STAGES.find((stage) => stage.id === stageId)?.label ?? stageId;
        const seed = seededFloat(`${node.id}-ready-${i}`);
        const stage = this.layout.stageBounds[stageId];
        const stageSpan = stage.endX - stage.startX;
        const targetX = stage.startX + stageSpan * (0.25 + seed * 0.45);
        plans.push({
          id: `wo-${node.id}-ready-${i}`,
          projectId: node.id,
          projectName: node.name,
          type: "wo",
          stageId,
          stageLabel,
          status: "ready",
          run: null,
          workOrderId: null,
          targetX,
          targetY: lane.centerY,
          radius: 8,
          targetOpacity: 0.6,
          isActive: false,
          isTerminal: false,
          isFailed: false,
          isSuccess: false,
        });
      }
    }

    const grouped = new Map<string, Map<StageId, BubblePlan[]>>();
    for (const plan of plans) {
      const stageGroups = grouped.get(plan.projectId) ?? new Map<StageId, BubblePlan[]>();
      const list = stageGroups.get(plan.stageId) ?? [];
      list.push(plan);
      stageGroups.set(plan.stageId, list);
      grouped.set(plan.projectId, stageGroups);
    }

    for (const [projectId, stageGroups] of grouped.entries()) {
      const lane = laneByProject.get(projectId);
      if (!lane) continue;
      for (const list of stageGroups.values()) {
        list.sort((a, b) => a.id.localeCompare(b.id));
        list.forEach((plan, index) => {
          const offset =
            (index - (list.length - 1) / 2) * BUBBLE_STACK_SPACING +
            (plan.isFailed ? 8 : 0);
          plan.targetY = lane.centerY + offset;
        });
      }
    }

    const nextIds = new Set(plans.map((plan) => plan.id));
    for (const plan of plans) {
      const stage = this.layout.stageBounds[plan.stageId];
      const existing = this.bubbleStates.get(plan.id);
      if (existing) {
        existing.projectId = plan.projectId;
        existing.projectName = plan.projectName;
        existing.type = plan.type;
        existing.stageId = plan.stageId;
        existing.stageLabel = plan.stageLabel;
        existing.status = plan.status;
        existing.run = plan.run;
        existing.workOrderId = plan.workOrderId;
        existing.targetX = plan.targetX;
        existing.targetY = plan.targetY;
        existing.radius = plan.radius;
        existing.targetOpacity = plan.targetOpacity;
        existing.isActive = plan.isActive;
        existing.isTerminal = plan.isTerminal;
        existing.isFailed = plan.isFailed;
        existing.isSuccess = plan.isSuccess;
        continue;
      }

      const seed = seededFloat(plan.id);
      const stageSpan = stage.endX - stage.startX;
      const startX = plan.isActive
        ? stage.startX + stageSpan * (0.08 + seed * 0.2)
        : plan.targetX;
      this.bubbleStates.set(plan.id, {
        ...plan,
        x: startX,
        y: plan.targetY + (seed - 0.5) * 6,
        opacity: plan.isTerminal ? 0.8 : plan.targetOpacity,
        bobSeed: seed * Math.PI * 2,
        driftSeed: seed * 8,
      });
    }

    for (const id of this.bubbleStates.keys()) {
      if (!nextIds.has(id)) this.bubbleStates.delete(id);
    }
  }

  private drawStageBands(ctx: CanvasRenderingContext2D, layout: Layout): void {
    for (const stage of STAGES) {
      const bounds = layout.stageBounds[stage.id];
      const width = bounds.endX - bounds.startX;
      ctx.fillStyle = withAlpha(stage.color, 0.45);
      ctx.fillRect(bounds.startX, layout.riverTop - 36, width, layout.riverBottom - layout.riverTop + 52);
      ctx.strokeStyle = withAlpha(stage.accent, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bounds.startX, layout.riverTop - 30);
      ctx.lineTo(bounds.startX, layout.riverBottom + 18);
      ctx.stroke();

      ctx.fillStyle = withAlpha(stage.accent, 0.85);
      ctx.font = "11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(stage.label.toUpperCase(), bounds.centerX, layout.riverTop - 10);
    }
  }

  private drawLanes(ctx: CanvasRenderingContext2D, layout: Layout): void {
    for (const lane of layout.lanes) {
      const laneGradient = ctx.createLinearGradient(layout.riverLeft, lane.centerY, layout.riverRight, lane.centerY);
      laneGradient.addColorStop(0, "rgba(24, 36, 52, 0.45)");
      laneGradient.addColorStop(1, "rgba(16, 32, 42, 0.35)");
      ctx.fillStyle = laneGradient;
      ctx.fillRect(layout.riverLeft, lane.top, layout.riverRight - layout.riverLeft, LANE_HEIGHT);

      ctx.strokeStyle = "rgba(98, 120, 150, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(layout.riverLeft, lane.top);
      ctx.lineTo(layout.riverRight, lane.top);
      ctx.moveTo(layout.riverLeft, lane.bottom);
      ctx.lineTo(layout.riverRight, lane.bottom);
      ctx.stroke();

      const labelX = layout.labelX;
      const labelY = lane.centerY - 16;
      ctx.fillStyle = "rgba(12, 16, 26, 0.85)";
      drawRoundedRect(ctx, labelX, labelY, layout.labelWidth, 32, 14);
      ctx.fill();
      ctx.strokeStyle = "rgba(70, 82, 104, 0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#e6e8ee";
      ctx.font = "12px system-ui";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(lane.node.name, labelX + 12, lane.centerY - 4);

      ctx.fillStyle = "#9aa6bf";
      ctx.font = "10px system-ui";
      const counts = lane.node.workOrders;
      ctx.fillText(
        `${counts.ready} ready  ${counts.building} building`,
        labelX + 12,
        lane.centerY + 10
      );
    }
  }

  private drawBubbles(ctx: CanvasRenderingContext2D, layout: Layout, delta: number, now: number): void {
    for (const bubble of this.bubbleStates.values()) {
      const positionRate = bubble.isTerminal ? 1.6 : bubble.isActive ? 2.4 : 1.8;
      const fadeRate = bubble.isTerminal ? 0.6 : 2.2;
      bubble.x = lerp(bubble.x, bubble.targetX, smoothFactor(delta, positionRate));
      bubble.y = lerp(bubble.y, bubble.targetY, smoothFactor(delta, positionRate));
      bubble.opacity = lerp(bubble.opacity, bubble.targetOpacity, smoothFactor(delta, fadeRate));

      if (bubble.isActive && !bubble.isTerminal) {
        const stage = layout.stageBounds[bubble.stageId];
        bubble.x = Math.min(bubble.x + delta * 10, stage.endX - ACTIVE_TARGET_PADDING);
      }

      if (bubble.opacity <= 0.03) continue;

      const bob = Math.sin(now * 0.002 + bubble.bobSeed) * (bubble.isActive ? 3.2 : 1.6);
      const waitingJitter = bubble.status === "waiting_for_input" ? 1.6 : 0;
      const jitterX = waitingJitter
        ? Math.sin(now * 0.02 + bubble.driftSeed) * waitingJitter
        : 0;
      const jitterY = waitingJitter
        ? Math.cos(now * 0.018 + bubble.driftSeed) * waitingJitter
        : 0;
      const renderX = bubble.x + jitterX;
      const renderY = bubble.y + bob + jitterY;
      const color = bubbleColor(bubble);
      const fillAlpha = bubble.type === "wo" ? bubble.opacity * 0.5 : bubble.opacity * 0.95;
      ctx.save();
      if (bubble.isActive || bubble.isSuccess) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = withAlpha(color, 0.4);
      }

      ctx.fillStyle = withAlpha(color, fillAlpha);
      ctx.strokeStyle = withAlpha(color, bubble.opacity);
      ctx.lineWidth = bubble.type === "run" ? 1.6 : 1;
      ctx.beginPath();
      ctx.arc(renderX, renderY, bubble.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (bubble.isFailed) {
        ctx.strokeStyle = withAlpha("#fda4af", bubble.opacity);
        ctx.beginPath();
        ctx.moveTo(renderX - bubble.radius * 0.5, renderY + bubble.radius * 0.5);
        ctx.lineTo(renderX + bubble.radius * 0.5, renderY - bubble.radius * 0.5);
        ctx.stroke();
      }

      if (bubble.id === this.selectedBubbleId) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(renderX, renderY, bubble.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  render(): void {
    if (!this.ctx || !this.layout) return;
    const ctx = this.ctx;
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    ctx.save();
    this.drawStageBands(ctx, this.layout);
    this.drawLanes(ctx, this.layout);
    this.drawBubbles(ctx, this.layout, delta, now);
    ctx.restore();
  }

  getBubbleAtPoint(point: { x: number; y: number }): RiverBubbleDetails | null {
    let closest: RiverBubbleState | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const bubble of this.bubbleStates.values()) {
      if (bubble.type !== "run" || !bubble.run || bubble.opacity <= 0.1) continue;
      const dx = point.x - bubble.x;
      const dy = point.y - bubble.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= bubble.radius + 4 && distance < closestDistance) {
        closest = bubble;
        closestDistance = distance;
      }
    }

    if (!closest || !closest.run) return null;
    return {
      bubbleId: closest.id,
      runId: closest.run.id,
      projectId: closest.projectId,
      projectName: closest.projectName,
      status: closest.run.status,
      stageId: closest.stageId,
      stageLabel: closest.stageLabel,
      workOrderId: closest.run.work_order_id,
      createdAt: closest.run.created_at,
      startedAt: closest.run.started_at,
      finishedAt: closest.run.finished_at,
      escalation: closest.run.escalation,
    };
  }

  setSelectedBubbleId(id: string | null): void {
    this.selectedBubbleId = id;
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this.bubbleStates.clear();
    this.layout = null;
  }
}

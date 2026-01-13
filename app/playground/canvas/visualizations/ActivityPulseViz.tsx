import type { Visualization, VisualizationData, VisualizationNode } from "../types";

type PulseRing = {
  radius: number;
  opacity: number;
  speed: number;
  fade: number;
  width: number;
};

type NodeState = {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  baseRadius: number;
  targetRadius: number;
  currentRadius: number;
  targetGlow: number;
  currentGlow: number;
  pulseRings: PulseRing[];
  pulseTimer: number;
  breathingPhase: number;
  jitterSeed: number;
  isActive: boolean;
};

type Palette = {
  base: string;
  label: string;
};

const COLORS = {
  activeBuilding: "#2b5cff",
  activeTesting: "#22d3ee",
  activeReviewing: "#a855f7",
  healthyIdle: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  parked: "#64748b",
};

const MIN_RADIUS = 12;
const MAX_RADIUS = 64;
const IDLE_SCALE = 0.78;
const ACTIVE_SCALE = 1.18;
const PULSE_INTERVAL = 1.8;
const MAX_RINGS = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function smoothFactor(delta: number, rate: number): number {
  return 1 - Math.exp(-rate * delta);
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

function radiusFromConsumption(consumptionRate: number): number {
  const scaled = Math.log10(Math.max(1, consumptionRate));
  const radius = 12 + scaled * 12;
  return clamp(radius, MIN_RADIUS, MAX_RADIUS);
}

function activityScale(level: number): number {
  return lerp(IDLE_SCALE, ACTIVE_SCALE, clamp(level, 0, 1));
}

function layoutNodes(nodes: VisualizationNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return positions;
  const ordered = [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const rows = Math.ceil(ordered.length / columns);
  const spacingX = 180;
  const spacingY = 160;

  ordered.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = (col - (columns - 1) / 2) * spacingX;
    const y = (row - (rows - 1) / 2) * spacingY;
    positions.set(node.id, { x, y });
  });

  return positions;
}

function paletteForNode(node: VisualizationNode): Palette {
  const hasError = node.needsHuman || node.health < 0.35;
  const hasWarning = node.health <= 0.55;

  if (hasError) {
    return { base: COLORS.error, label: "#ffd3d3" };
  }

  if (node.status === "parked") {
    return { base: COLORS.parked, label: "#cbd5f5" };
  }

  if (node.activePhase === "waiting" || hasWarning) {
    return { base: COLORS.warning, label: "#fde68a" };
  }

  if (!node.isActive) {
    return { base: COLORS.healthyIdle, label: "#bbf7d0" };
  }

  if (node.activePhase === "testing") {
    return { base: COLORS.activeTesting, label: "#cffafe" };
  }

  if (node.activePhase === "reviewing") {
    return { base: COLORS.activeReviewing, label: "#e9d5ff" };
  }

  return { base: COLORS.activeBuilding, label: "#c7d2fe" };
}

export class ActivityPulseVisualization implements Visualization {
  id = "activity_pulse";
  name = "Activity Pulse";
  description = "Pulsing project nodes with activity glow and consumption sizing.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };
  private nodeStates = new Map<string, NodeState>();
  private lastFrame = 0;

  init(canvas: HTMLCanvasElement, data: VisualizationData): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.lastFrame = performance.now();
    this.update(data);
  }

  update(data: VisualizationData): void {
    this.data = data;
    const layout = layoutNodes(data.nodes);
    const seen = new Set<string>();

    for (const node of data.nodes) {
      const position = layout.get(node.id) ?? { x: 0, y: 0 };
      const baseRadius = radiusFromConsumption(node.consumptionRate);
      const targetRadius = baseRadius * activityScale(node.activityLevel);
      const targetGlow = clamp(node.activityLevel, 0, 1);
      const existing = this.nodeStates.get(node.id);
      if (existing) {
        existing.targetX = position.x;
        existing.targetY = position.y;
        existing.baseRadius = baseRadius;
        existing.targetRadius = targetRadius;
        existing.targetGlow = targetGlow;
        if (node.isActive && !existing.isActive) {
          existing.pulseTimer = 0;
        }
        existing.isActive = node.isActive;
      } else {
        this.nodeStates.set(node.id, {
          id: node.id,
          x: position.x,
          y: position.y,
          targetX: position.x,
          targetY: position.y,
          baseRadius,
          targetRadius,
          currentRadius: targetRadius,
          targetGlow,
          currentGlow: targetGlow,
          pulseRings: [],
          pulseTimer: Math.random() * PULSE_INTERVAL,
          breathingPhase: Math.random() * Math.PI * 2,
          jitterSeed: Math.random() * Math.PI * 2,
          isActive: node.isActive,
        });
      }
      seen.add(node.id);
    }

    for (const id of this.nodeStates.keys()) {
      if (!seen.has(id)) this.nodeStates.delete(id);
    }
  }

  private spawnPulse(state: NodeState, intensity: number): void {
    const ring: PulseRing = {
      radius: state.currentRadius + 4,
      opacity: clamp(0.35 + intensity * 0.5, 0.2, 0.8),
      speed: 22 + intensity * 16,
      fade: 0.45 + intensity * 0.25,
      width: 2,
    };
    state.pulseRings.push(ring);
    if (state.pulseRings.length > MAX_RINGS) {
      state.pulseRings.splice(0, state.pulseRings.length - MAX_RINGS);
    }
  }

  render(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    for (const node of this.data.nodes) {
      const state = this.nodeStates.get(node.id);
      if (!state) continue;

      const positionSmoothing = smoothFactor(delta, 6);
      const radiusSmoothing = smoothFactor(delta, 5);
      const glowSmoothing = smoothFactor(delta, 4);

      state.x = lerp(state.x, state.targetX, positionSmoothing);
      state.y = lerp(state.y, state.targetY, positionSmoothing);
      state.currentRadius = lerp(state.currentRadius, state.targetRadius, radiusSmoothing);
      state.currentGlow = lerp(state.currentGlow, state.targetGlow, glowSmoothing);

      node.x = state.x;
      node.y = state.y;
      node.radius = state.currentRadius;

      const shouldPulse =
        node.isActive && node.activePhase !== "waiting" && node.activePhase !== undefined;
      if (shouldPulse) {
        state.pulseTimer -= delta;
        if (state.pulseTimer <= 0) {
          this.spawnPulse(state, state.currentGlow);
          state.pulseTimer = PULSE_INTERVAL;
        }
      }

      state.pulseRings = state.pulseRings.filter((ring) => {
        ring.radius += ring.speed * delta;
        ring.opacity -= ring.fade * delta;
        return ring.opacity > 0 && ring.radius < state.currentRadius + 90;
      });

      const palette = paletteForNode(node);
      const glowIntensity = clamp(state.currentGlow, 0, 1);
      const fillAlpha = clamp(0.3 + glowIntensity * 0.5 + (node.isActive ? 0.12 : 0), 0.2, 0.92);
      const outlineAlpha = node.isActive ? 0.9 : 0.55;
      const labelAlpha = clamp(0.35 + glowIntensity * 0.5, 0.2, 0.9);
      const parkedDimming = node.status === "parked" ? 0.7 : 1;

      const jitterAmount =
        node.needsHuman || node.health < 0.35 ? 1.6 : 0;
      const jitterX = jitterAmount
        ? Math.sin(now * 0.008 + state.jitterSeed) * jitterAmount
        : 0;
      const jitterY = jitterAmount
        ? Math.cos(now * 0.006 + state.jitterSeed) * jitterAmount
        : 0;

      const breathe = Math.sin(now * 0.002 + state.breathingPhase) * (node.isActive ? 1.8 : 0.6);
      const renderX = state.x + jitterX;
      const renderY = state.y + jitterY;
      const renderRadius = Math.max(6, state.currentRadius + breathe);

      for (const ring of state.pulseRings) {
        ctx.strokeStyle = withAlpha(palette.base, ring.opacity);
        ctx.lineWidth = ring.width;
        ctx.beginPath();
        ctx.arc(renderX, renderY, ring.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.save();
      ctx.shadowBlur = 8 + glowIntensity * 26;
      ctx.shadowColor = withAlpha(palette.base, glowIntensity * 0.65);
      ctx.fillStyle = withAlpha(palette.base, fillAlpha * parkedDimming);
      ctx.strokeStyle = withAlpha(palette.base, outlineAlpha * parkedDimming);
      ctx.lineWidth = node.isActive ? 2 : 1;
      ctx.beginPath();
      ctx.arc(renderX, renderY, renderRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (node.needsHuman) {
        const dotRadius = 6;
        ctx.fillStyle = "#ff5c6a";
        ctx.beginPath();
        ctx.arc(
          renderX + renderRadius * 0.55,
          renderY - renderRadius * 0.55,
          dotRadius,
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
            renderX + renderRadius * 0.55,
            renderY - renderRadius * 0.55
          );
        }
      }

      ctx.fillStyle = withAlpha(palette.label, labelAlpha);
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label, renderX, renderY + renderRadius + 6);
    }
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this.nodeStates.clear();
  }
}

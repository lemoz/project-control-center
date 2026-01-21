import type {
  ProjectNode,
  Visualization,
  VisualizationData,
  VisualizationNode,
} from "../types";

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
};

const BASE_ZONES: Zone[] = [
  { name: "focus", minR: 0, maxR: 80, color: "#fef3c7", label: "Focus" },
  { name: "active", minR: 80, maxR: 180, color: "#fef9c3", label: "Active" },
  { name: "ready", minR: 180, maxR: 280, color: "#f0fdf4", label: "Ready" },
  { name: "idle", minR: 280, maxR: 400, color: "#f8fafc", label: "Idle" },
];

const BASE_OUTER_RADIUS = 400;
const ARCHIVE_EXTENSION = 80;
const BASE_FOCUS_RADIUS = 34;
const BASE_SUN_RADIUS = 18;
const LABEL_OFFSET = 12;
const RADIAL_JITTER = 12;

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
};

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

function radiusFromConsumption(consumptionRate: number): number {
  const scaled = Math.log10(Math.max(1, consumptionRate));
  const radius = 10 + scaled * 8;
  return clamp(radius, 10, 30);
}

function targetHeatFor(node: ProjectNode): number {
  let heat = clamp(node.activityLevel, 0, 1);
  if (node.isActive) heat = Math.max(heat, 0.65);
  if (node.needsHuman || node.status === "blocked") heat = Math.max(heat, 0.78);
  if (node.activePhase === "testing") heat = Math.max(heat, 0.7);
  if (node.activePhase === "reviewing") heat = Math.max(heat, 0.62);
  if (node.activePhase === "waiting") heat = Math.max(heat, 0.55);
  if (node.status === "parked") heat = Math.min(heat, 0.2);
  return clamp(heat, 0, 1);
}

function paletteForNode(node: ProjectNode): Palette {
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

function computeOrbitRadius(node: ProjectNode, heat: number, layout: Layout): number {
  const outerTarget =
    node.status === "parked" || (!node.isActive && node.activityLevel < 0.2)
      ? layout.archiveRadius
      : layout.outerRadius;
  return lerp(outerTarget, layout.innerOrbitRadius, heat);
}

export class OrbitalGravityVisualization implements Visualization {
  id = "orbital_gravity";
  name = "Orbital Gravity";
  description = "Attention gravity view with orbital drift and focus pull.";

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private data: VisualizationData = { nodes: [], edges: [], timestamp: new Date() };
  private nodeStates = new Map<string, OrbitalNodeState>();
  private lastFrame = 0;
  private focusedId: string | null = null;
  private focusUntil = 0;
  private hoveredId: string | null = null;

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

    for (const node of data.nodes) {
      const baseRadius = radiusFromConsumption(node.consumptionRate);
      const targetHeat = targetHeatFor(node);
      const radialOffset = (seededFloat(`${node.id}-radius`) - 0.5) * RADIAL_JITTER * 2;
      const initialRadius = computeOrbitRadius(node, targetHeat, layout) + radialOffset;
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
  }

  onNodeClick(node: VisualizationNode | null): void {
    if (!node || node.type !== "project") {
      this.focusedId = null;
      return;
    }
    this.focusedId = node.id;
    this.focusUntil = performance.now() + FOCUS_DURATION_MS;
  }

  onNodeHover(node: VisualizationNode | null): void {
    this.hoveredId = node && node.type === "project" ? node.id : null;
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

    for (const node of this.data.nodes) {
      const state = this.nodeStates.get(node.id);
      if (!state) continue;

      const targetHeat = targetHeatFor(node);
      const heatRate = targetHeat > state.heat ? HEAT_GAIN_RATE : HEAT_DECAY_RATE;
      state.heat = lerp(state.heat, targetHeat, smoothFactor(delta, heatRate));

      const baseTargetRadius = computeOrbitRadius(node, state.heat, layout) + state.radialOffset;
      let focusBlend = 0;
      if (this.focusedId === node.id && now < this.focusUntil) {
        const remaining = this.focusUntil - now;
        focusBlend = remaining < FOCUS_FADE_MS ? remaining / FOCUS_FADE_MS : 1;
      }
      const desiredRadius = lerp(baseTargetRadius, layout.focusRadius, focusBlend);
      state.targetRadius = desiredRadius;
      state.radius = lerp(state.radius, state.targetRadius, smoothFactor(delta, RADIUS_SMOOTH_RATE));

      const speedFactor = layout.outerRadius / Math.max(state.radius, layout.focusRadius);
      const focusSpeedDamp = lerp(1, 0.4, focusBlend);
      state.angularVelocity = clamp(
        BASE_ORBIT_SPEED * speedFactor * focusSpeedDamp,
        MIN_ORBIT_SPEED,
        MAX_ORBIT_SPEED
      );
      state.angle += state.angularVelocity * delta;

      const orbitX = Math.cos(state.angle) * state.radius;
      const orbitY = Math.sin(state.angle) * state.radius;
      const hoverBoost = this.hoveredId === node.id ? 0.12 : 0;
      const focusBoost = focusBlend > 0 ? 0.18 : 0;
      const size = state.baseRadius * (1 + state.heat * 0.25 + hoverBoost + focusBoost);

      node.x = orbitX;
      node.y = orbitY;
      node.radius = size;

      const palette = paletteForNode(node);
      const idleDimming = node.isActive ? 1 : 0.7;
      const glow = clamp(0.25 + state.heat * 0.65, 0.2, 0.95) * idleDimming;
      const fillAlpha = clamp(0.28 + state.heat * 0.5, 0.2, 0.85) * idleDimming;
      const strokeAlpha = clamp(0.35 + state.heat * 0.45, 0.25, 0.9) * idleDimming;

      ctx.save();
      ctx.shadowBlur = 10 + state.heat * 24;
      ctx.shadowColor = withAlpha(palette.glow, glow * 0.6);
      ctx.fillStyle = withAlpha(palette.base, fillAlpha);
      ctx.strokeStyle = withAlpha(palette.base, strokeAlpha);
      ctx.lineWidth = node.isActive ? 1.6 : 1;
      ctx.beginPath();
      ctx.arc(orbitX, orbitY, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (node.needsHuman) {
        const dotRadius = 6;
        ctx.fillStyle = "#ff5c6a";
        ctx.beginPath();
        ctx.arc(orbitX + size * 0.55, orbitY - size * 0.55, dotRadius, 0, Math.PI * 2);
        ctx.fill();

        if (node.escalationCount > 1) {
          ctx.fillStyle = "#fff";
          ctx.font = "10px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            String(node.escalationCount),
            orbitX + size * 0.55,
            orbitY - size * 0.55
          );
        }
      }

      const labelAlpha = clamp(0.25 + state.heat * 0.6, 0.2, 0.9) * idleDimming;
      ctx.fillStyle = withAlpha(palette.label, labelAlpha);
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(node.label, orbitX, orbitY + size + LABEL_OFFSET);
    }
  }

  destroy(): void {
    this.canvas = null;
    this.ctx = null;
    this.nodeStates.clear();
  }

  private getLayout(): Layout {
    const rect = this.canvas?.getBoundingClientRect();
    const minDimension = rect ? Math.min(rect.width, rect.height) : 520;
    const maxRadius = minDimension * 0.45;
    const scale = maxRadius / BASE_OUTER_RADIUS;
    const zones = BASE_ZONES.map((zone) => ({
      ...zone,
      minR: zone.minR * scale,
      maxR: zone.maxR * scale,
    }));
    const outerRadius = zones[zones.length - 1].maxR;
    const archiveRadius = outerRadius + ARCHIVE_EXTENSION * scale;
    const activeZone = zones[1] ?? zones[0];
    const innerOrbitRadius = (activeZone.minR + activeZone.maxR) / 2;
    const focusRadius = Math.max(activeZone.minR * 0.5, BASE_FOCUS_RADIUS * scale);
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

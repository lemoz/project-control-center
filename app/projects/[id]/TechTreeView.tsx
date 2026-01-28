"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, WheelEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TechTreeFilters, type TechTreeTrackOption } from "./TechTreeFilters";
import { TechTreeLegend } from "./TechTreeLegend";
import { TechTreeSwimlanes, type TechTreeLaneLayout } from "./TechTreeSwimlanes";

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
  updatedAt: string | null;
  dependsOn: string[];
  dependents: string[];
  trackId: string | null;
  track: { id: string; name: string; color: string | null } | null;
  trackIds: string[];
  tracks: { id: string; name: string; color: string | null }[];
  projectId: string;
  projectName: string;
  isExternal: boolean;
};

type TrackSummary = {
  id: string;
  name: string;
  color: string | null;
  sortOrder?: number;
};

type TechTreeResponse = {
  nodes: DependencyNode[];
  cycles: string[][];
  eras: string[];
  tracks?: TrackSummary[];
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

const ERA_LANES = [
  { id: "v0", label: "v0", color: "#1f2937" },
  { id: "v1", label: "v1", color: "#0f766e" },
  { id: "v2", label: "v2", color: "#1d4ed8" },
] as const;
type EraId = (typeof ERA_LANES)[number]["id"] | "unassigned";
const ERA_LANE_IDS = new Set<string>(ERA_LANES.map((lane) => lane.id));
const UNASSIGNED_ERA_ID: EraId = "unassigned";
const UNASSIGNED_ERA = { id: UNASSIGNED_ERA_ID, label: "Unassigned", color: "#475569" };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const HORIZONTAL_GAP = 100;
const ERA_COLUMN_WIDTH = NODE_WIDTH + HORIZONTAL_GAP;
const VERTICAL_GAP = 30;
const LANE_HEADER_HEIGHT = 32;
const LANE_PADDING_Y = 16;
const LANE_GAP = 24;
const LEFT_PADDING = 60;
const RIGHT_PADDING = 120;
const TOP_PADDING = 50;
const BOTTOM_PADDING = 50;
const UNASSIGNED_LANE_ID = "unassigned";
const MIN_SCALE = 0.1;
const MAX_SCALE = 2.5;
const SCALE_STEP = 1.15;
const FIT_PADDING = 0.94;
const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 160;
const HIDDEN_EDGE_STUB = 40;
const DEFAULT_TRACK_COLOR = "#334155";
const BASE_NODE_FILL = "#2d2d44";

const resolveTrackIds = (node: DependencyNode): string[] => {
  const ids = Array.isArray(node.trackIds) ? node.trackIds : [];
  if (ids.length > 0) return ids;
  if (node.track?.id) return [node.track.id];
  if (node.trackId) return [node.trackId];
  return [];
};

const resolveTrackId = (node: DependencyNode): string => {
  const ids = resolveTrackIds(node);
  return ids[0] ?? UNASSIGNED_LANE_ID;
};

const parseHexColor = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("#")) return null;
  const hex = trimmed.slice(1);
  if (hex.length !== 3 && hex.length !== 6) return null;
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : hex;
  const int = Number.parseInt(expanded, 16);
  if (Number.isNaN(int)) return null;
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
};

const applyAlpha = (color: string, alpha: number) => {
  const parsed = parseHexColor(color);
  if (!parsed) return color;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
};

const trackTint = (color: string | null) => {
  if (!color) return BASE_NODE_FILL;
  return applyAlpha(color, 0.18);
};

type LaneLayout = TechTreeLaneLayout;

type EraLaneLayout = {
  id: string;
  label: string;
  color: string;
  x: number;
  width: number;
};

type Viewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViewMode = "era" | "depth";

type SwimlaneSortMode = "manual" | "activity" | "count" | "alpha";

type TrackFilterItem = TechTreeTrackOption & {
  sortOrder: number | null;
};

export function TechTreeView({ repoId, onClose }: { repoId: string; onClose?: () => void }) {
  const [data, setData] = useState<TechTreeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [collapsedLanes, setCollapsedLanes] = useState<Record<string, boolean>>({});
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("depth");
  const [swimlanesEnabled, setSwimlanesEnabled] = useState(false);
  const [swimlaneSort, setSwimlaneSort] = useState<SwimlaneSortMode>("manual");
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, width: 0, height: 0 });
  const [isScaleReady, setIsScaleReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  const zoomStorageKey = `pcc.techTree.zoom.${repoId}`;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const toggleLane = useCallback((laneId: string) => {
    setCollapsedLanes((prev) => ({ ...prev, [laneId]: !prev[laneId] }));
  }, []);

  const clampScale = useCallback((value: number) => {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
  }, []);

  const updateViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const nextScale = scaleRef.current;
    setViewport({
      x: container.scrollLeft / nextScale,
      y: container.scrollTop / nextScale,
      width: container.clientWidth / nextScale,
      height: container.clientHeight / nextScale,
    });
  }, []);

  const applyScale = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }) => {
      const container = containerRef.current;
      const prevScale = scaleRef.current;
      const clamped = clampScale(nextScale);
      setScale(clamped);

      if (!container) return;

      const { scrollLeft, scrollTop, clientWidth, clientHeight } = container;
      const anchorX = anchor
        ? (scrollLeft + anchor.x) / prevScale
        : (scrollLeft + clientWidth / 2) / prevScale;
      const anchorY = anchor
        ? (scrollTop + anchor.y) / prevScale
        : (scrollTop + clientHeight / 2) / prevScale;

      requestAnimationFrame(() => {
        container.scrollLeft = Math.max(0, anchorX * clamped - (anchor ? anchor.x : clientWidth / 2));
        container.scrollTop = Math.max(0, anchorY * clamped - (anchor ? anchor.y : clientHeight / 2));
        updateViewport();
      });
    },
    [clampScale, updateViewport],
  );

  const zoomIn = useCallback(() => {
    applyScale(scaleRef.current * SCALE_STEP);
  }, [applyScale]);

  const zoomOut = useCallback(() => {
    applyScale(scaleRef.current / SCALE_STEP);
  }, [applyScale]);

  const resetZoom = useCallback(() => {
    applyScale(1);
  }, [applyScale]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(zoomStorageKey);
    const parsed = stored ? Number.parseFloat(stored) : Number.NaN;
    if (Number.isFinite(parsed)) {
      setScale(clampScale(parsed));
    } else {
      setScale(1);
    }
    setIsScaleReady(true);
  }, [zoomStorageKey, clampScale]);

  useEffect(() => {
    if (!isScaleReady || typeof window === "undefined") return;
    window.sessionStorage.setItem(zoomStorageKey, scale.toFixed(3));
  }, [isScaleReady, scale, zoomStorageKey]);

  useEffect(() => {
    const handleResize = () => updateViewport();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateViewport]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetZoom, zoomIn, zoomOut]);

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

  const tracksParam = searchParams.get("tracks");

  const trackStats = useMemo(() => {
    const counts = new Map<string, number>();
    const latestActivity = new Map<string, number>();
    if (!data) return { counts, latestActivity };

    for (const node of data.nodes) {
      const ids = resolveTrackIds(node);
      const trackIds = ids.length > 0 ? ids : [UNASSIGNED_LANE_ID];
      for (const trackId of trackIds) {
        counts.set(trackId, (counts.get(trackId) ?? 0) + 1);
        if (node.updatedAt) {
          const timestamp = Date.parse(node.updatedAt);
          if (!Number.isNaN(timestamp)) {
            const current = latestActivity.get(trackId) ?? 0;
            if (timestamp > current) latestActivity.set(trackId, timestamp);
          }
        }
      }
    }

    return { counts, latestActivity };
  }, [data]);

  const trackOptions = useMemo<TrackFilterItem[]>(() => {
    if (!data) return [];
    const byId = new Map<string, TrackFilterItem>();

    for (const track of data.tracks ?? []) {
      byId.set(track.id, {
        id: track.id,
        name: track.name,
        color: track.color ?? null,
        sortOrder: track.sortOrder ?? null,
        isUnassigned: false,
        count: trackStats.counts.get(track.id) ?? 0,
      });
    }

    for (const node of data.nodes) {
      const nodeTrackIds = resolveTrackIds(node);
      if (nodeTrackIds.length === 0) continue;
      for (const trackId of nodeTrackIds) {
        const trackMeta =
          (node.tracks ?? []).find((track) => track.id === trackId) ??
          (node.track?.id === trackId ? node.track : null);
        const existing = byId.get(trackId);
        const nodeName = trackMeta?.name ?? trackId;
        const nodeColor = trackMeta?.color ?? null;
        if (existing) {
          if (trackMeta?.name && existing.name === trackId) {
            existing.name = trackMeta.name;
          }
          if (!existing.color && nodeColor) {
            existing.color = nodeColor;
          }
          existing.count = trackStats.counts.get(trackId) ?? existing.count;
        } else {
          byId.set(trackId, {
            id: trackId,
            name: nodeName,
            color: nodeColor,
            sortOrder: null,
            isUnassigned: false,
            count: trackStats.counts.get(trackId) ?? 0,
          });
        }
      }
    }

    const hasUnassigned = data.nodes.some((node) => resolveTrackIds(node).length === 0);
    if (hasUnassigned && !byId.has(UNASSIGNED_LANE_ID)) {
      byId.set(UNASSIGNED_LANE_ID, {
        id: UNASSIGNED_LANE_ID,
        name: "Unassigned",
        color: DEFAULT_TRACK_COLOR,
        sortOrder: Number.MAX_SAFE_INTEGER,
        isUnassigned: true,
        count: trackStats.counts.get(UNASSIGNED_LANE_ID) ?? 0,
      });
    }

    const list = Array.from(byId.values());
    list.sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [data, trackStats]);

  const parsedTracks = useMemo(() => {
    if (tracksParam === null) return null;
    return tracksParam
      .split(",")
      .map((trackId) => trackId.trim())
      .filter(Boolean);
  }, [tracksParam]);

  const visibleTrackIds = useMemo(() => {
    if (!trackOptions.length) return null;
    if (!parsedTracks) return new Set(trackOptions.map((track) => track.id));
    const allowed = new Set(trackOptions.map((track) => track.id));
    const selected = new Set<string>();
    for (const trackId of parsedTracks) {
      if (allowed.has(trackId)) selected.add(trackId);
    }
    return selected;
  }, [parsedTracks, trackOptions]);

  const isTrackVisible = useCallback(
    (trackId: string) => {
      if (!visibleTrackIds) return true;
      return visibleTrackIds.has(trackId);
    },
    [visibleTrackIds],
  );

  const isLaneVisible = useCallback(
    (laneId: string) => {
      if (!swimlanesEnabled) return true;
      return isTrackVisible(laneId);
    },
    [isTrackVisible, swimlanesEnabled],
  );

  const nodeTrackIds = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    for (const node of data.nodes) {
      map.set(node.id, resolveTrackId(node));
    }
    return map;
  }, [data]);

  const nodeTrackIdLists = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!data) return map;
    for (const node of data.nodes) {
      const ids = resolveTrackIds(node);
      map.set(node.id, ids.length > 0 ? ids : [UNASSIGNED_LANE_ID]);
    }
    return map;
  }, [data]);

  const trackColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const track of trackOptions) {
      if (track.color) map.set(track.id, track.color);
    }
    return map;
  }, [trackOptions]);

  const visibleNodeIds = useMemo(() => {
    if (!data) return new Set<string>();
    if (!visibleTrackIds) return new Set(data.nodes.map((node) => node.id));
    const set = new Set<string>();
    for (const node of data.nodes) {
      const trackIds = nodeTrackIdLists.get(node.id) ?? [UNASSIGNED_LANE_ID];
      if (trackIds.some((trackId) => visibleTrackIds.has(trackId))) {
        set.add(node.id);
      }
    }
    return set;
  }, [data, nodeTrackIdLists, visibleTrackIds]);

  const nodeCountLabel = useMemo(() => {
    if (!data) return "";
    const visibleCount = visibleNodeIds.size;
    const total = data.nodes.length;
    if (visibleCount === total) return `${total} work orders`;
    return `${visibleCount} of ${total} work orders`;
  }, [data, visibleNodeIds]);

  const updateTracksParam = useCallback(
    (nextTrackIds: string[] | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!nextTrackIds) params.delete("tracks");
      else params.set("tracks", nextTrackIds.join(","));
      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;
      router.replace(href, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const showAllTracks = useCallback(() => {
    if (!trackOptions.length) return;
    updateTracksParam(null);
  }, [trackOptions.length, updateTracksParam]);

  const hideAllTracks = useCallback(() => {
    if (!trackOptions.length) return;
    updateTracksParam([]);
  }, [trackOptions.length, updateTracksParam]);

  const toggleTrackVisibility = useCallback(
    (trackId: string) => {
      if (!trackOptions.length) return;
      const allTrackIds = trackOptions.map((track) => track.id);
      const current = visibleTrackIds ? new Set(visibleTrackIds) : new Set(allTrackIds);
      if (current.has(trackId)) current.delete(trackId);
      else current.add(trackId);
      const nextIds = allTrackIds.filter((id) => current.has(id));
      if (nextIds.length === allTrackIds.length) updateTracksParam(null);
      else updateTracksParam(nextIds);
    },
    [trackOptions, updateTracksParam, visibleTrackIds],
  );

  useEffect(() => {
    if (selectedId && !visibleNodeIds.has(selectedId)) {
      setSelectedId(null);
    }
  }, [selectedId, visibleNodeIds]);

  useEffect(() => {
    if (hoveredId && !visibleNodeIds.has(hoveredId)) {
      setHoveredId(null);
    }
  }, [hoveredId, visibleNodeIds]);

  // Calculate node positions based on view mode (era lanes or depth) + track lanes
  const { nodePositions, nodeXPositions, svgWidth, svgHeight, lanes, eraColumns, maxDepth } = useMemo(() => {
    if (!data)
      return {
        nodePositions: new Map<string, { x: number; y: number }>(),
        nodeXPositions: new Map<string, number>(),
        svgWidth: 800,
        svgHeight: 600,
        lanes: [] as LaneLayout[],
        eraColumns: [] as EraLaneLayout[],
        maxDepth: 0,
      };

    const nodes = data.nodes;
    const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const positions = new Map<string, { x: number; y: number }>();
    const xPositions = new Map<string, number>();

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

    const computedMaxDepth = Math.max(...Array.from(depths.values()), 0);

    const normalizeEra = (value: string | null): EraId => {
      if (!value) return UNASSIGNED_ERA_ID;
      const trimmed = value.trim();
      return ERA_LANE_IDS.has(trimmed) ? (trimmed as EraId) : UNASSIGNED_ERA_ID;
    };

    // Era columns only used in era view mode
    const needsUnassigned = nodes.some((node) => normalizeEra(node.era) === UNASSIGNED_ERA_ID);
    const eraList = needsUnassigned ? [...ERA_LANES, UNASSIGNED_ERA] : [...ERA_LANES];
    const eraLayouts: EraLaneLayout[] = viewMode === "era"
      ? eraList.map((lane, index) => ({
          ...lane,
          x: LEFT_PADDING + index * ERA_COLUMN_WIDTH,
          width: ERA_COLUMN_WIDTH,
        }))
      : [];
    const eraIndexById = new Map(eraLayouts.map((lane, index) => [lane.id, index]));

    for (const node of nodes) {
      if (viewMode === "era") {
        const eraId = normalizeEra(node.era);
        const eraIndex = eraIndexById.get(eraId) ?? 0;
        xPositions.set(node.id, LEFT_PADDING + eraIndex * ERA_COLUMN_WIDTH);
      } else {
        const nodeDepth = depths.get(node.id) ?? 0;
        xPositions.set(node.id, LEFT_PADDING + nodeDepth * (NODE_WIDTH + HORIZONTAL_GAP));
      }
    }

    const trackById = new Map<string, TrackFilterItem>();
    trackOptions.forEach((track, index) => {
      trackById.set(track.id, { ...track, sortOrder: track.sortOrder ?? index });
    });

    type LaneSeed = {
      id: string;
      name: string;
      color: string | null;
      nodes: DependencyNode[];
      isUnassigned: boolean;
      sortOrder: number | null;
    };

    const lanesById = new Map<string, LaneSeed>();

    if (swimlanesEnabled) {
      for (const node of visibleNodes) {
        const laneId = resolveTrackId(node);
        const trackMeta = trackById.get(laneId);
        const primaryTrack = (node.tracks ?? [])[0] ?? node.track ?? null;
        const isUnassigned = trackMeta?.isUnassigned ?? laneId === UNASSIGNED_LANE_ID;
        const laneName =
          trackMeta?.name ??
          primaryTrack?.name ??
          laneId ??
          (isUnassigned ? "Unassigned" : "Unknown track");
        const laneColor = trackMeta?.color ?? primaryTrack?.color ?? DEFAULT_TRACK_COLOR;
        const laneOrder = trackMeta?.sortOrder ?? null;

        const existing = lanesById.get(laneId);
        if (existing) {
          existing.nodes.push(node);
        } else {
          lanesById.set(laneId, {
            id: laneId,
            name: laneName,
            color: laneColor,
            nodes: [node],
            isUnassigned,
            sortOrder: laneOrder,
          });
        }
      }
    } else if (visibleNodes.length > 0) {
      lanesById.set("all", {
        id: "all",
        name: "All Work Orders",
        color: null,
        nodes: [...visibleNodes],
        isUnassigned: false,
        sortOrder: null,
      });
    }

    let laneList = Array.from(lanesById.values());

    const compareManual = (a: LaneSeed, b: LaneSeed) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    };

    if (swimlanesEnabled) {
      const compareActivity = (a: LaneSeed, b: LaneSeed) => {
        if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
        const activityA = trackStats.latestActivity.get(a.id) ?? 0;
        const activityB = trackStats.latestActivity.get(b.id) ?? 0;
        if (activityA !== activityB) return activityB - activityA;
        return compareManual(a, b);
      };

      const compareCount = (a: LaneSeed, b: LaneSeed) => {
        if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
        if (a.nodes.length !== b.nodes.length) return b.nodes.length - a.nodes.length;
        return compareManual(a, b);
      };

      const compareAlpha = (a: LaneSeed, b: LaneSeed) => {
        if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
        return a.name.localeCompare(b.name);
      };

      const compareFn =
        swimlaneSort === "activity"
          ? compareActivity
          : swimlaneSort === "count"
            ? compareCount
            : swimlaneSort === "alpha"
              ? compareAlpha
              : compareManual;

      laneList.sort(compareFn);
    }

    for (const lane of laneList) {
      lane.nodes.sort((a, b) => {
        const depthA = depths.get(a.id) ?? 0;
        const depthB = depths.get(b.id) ?? 0;
        if (depthA !== depthB) return depthA - depthB;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.title.localeCompare(b.title);
      });
    }

    let yOffset = TOP_PADDING;
    const laneLayouts: LaneLayout[] = [];
    const laneHeaderHeight = swimlanesEnabled ? LANE_HEADER_HEIGHT : 0;

    for (const lane of laneList) {
      const isCollapsed = swimlanesEnabled ? (collapsedLanes[lane.id] ?? false) : false;
      const laneNodes = isCollapsed ? [] : lane.nodes;
      const nodeCount = laneNodes.length;
      const nodesHeight =
        nodeCount === 0 ? 0 : nodeCount * NODE_HEIGHT + (nodeCount - 1) * VERTICAL_GAP;
      const laneHeight = isCollapsed
        ? laneHeaderHeight + LANE_PADDING_Y
        : laneHeaderHeight + LANE_PADDING_Y + nodesHeight + LANE_PADDING_Y;
      const laneTop = yOffset;

      laneLayouts.push({
        id: lane.id,
        name: lane.name,
        color: lane.color,
        nodes: lane.nodes,
        isUnassigned: lane.isUnassigned,
        top: laneTop,
        height: laneHeight,
        isCollapsed,
      });

      laneNodes.forEach((node, idx) => {
        const xPos = xPositions.get(node.id) ?? LEFT_PADDING;
        positions.set(node.id, {
          x: xPos,
          y: laneTop + laneHeaderHeight + LANE_PADDING_Y + idx * (NODE_HEIGHT + VERTICAL_GAP),
        });
      });

      yOffset += laneHeight + LANE_GAP;
    }

    let width: number;
    if (viewMode === "era") {
      const columnCount = Math.max(1, eraLayouts.length);
      width = LEFT_PADDING + columnCount * ERA_COLUMN_WIDTH - HORIZONTAL_GAP + RIGHT_PADDING;
    } else {
      // Depth-based width
      width = LEFT_PADDING + (computedMaxDepth + 1) * (NODE_WIDTH + HORIZONTAL_GAP) + RIGHT_PADDING;
    }
    const height = Math.max(400, yOffset - LANE_GAP + BOTTOM_PADDING);

    return {
      nodePositions: positions,
      nodeXPositions: xPositions,
      svgWidth: Math.max(800, width),
      svgHeight: height,
      lanes: laneLayouts,
      eraColumns: eraLayouts,
      maxDepth: computedMaxDepth,
    };
  }, [
    collapsedLanes,
    data,
    swimlaneSort,
    swimlanesEnabled,
    trackOptions,
    trackStats,
    viewMode,
    visibleNodeIds,
  ]);

  const fitToScreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scaleX = container.clientWidth / svgWidth;
    const scaleY = container.clientHeight / svgHeight;
    const nextScale = clampScale(Math.min(scaleX, scaleY) * FIT_PADDING);
    setScale(nextScale);

    requestAnimationFrame(() => {
      const scaledWidth = svgWidth * nextScale;
      const scaledHeight = svgHeight * nextScale;
      container.scrollLeft = Math.max(0, (scaledWidth - container.clientWidth) / 2);
      container.scrollTop = Math.max(0, (scaledHeight - container.clientHeight) / 2);
      updateViewport();
    });
  }, [clampScale, svgWidth, svgHeight, updateViewport]);

  useEffect(() => {
    updateViewport();
  }, [scale, svgWidth, svgHeight, updateViewport]);

  const handleWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP;
      const rect = event.currentTarget.getBoundingClientRect();
      applyScale(scaleRef.current * factor, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [applyScale],
  );

  const handleMinimapClick = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      const targetX = (clickX / rect.width) * svgWidth;
      const targetY = (clickY / rect.height) * svgHeight;
      const nextScale = scaleRef.current;
      const maxScrollLeft = Math.max(0, svgWidth * nextScale - container.clientWidth);
      const maxScrollTop = Math.max(0, svgHeight * nextScale - container.clientHeight);
      const nextLeft = Math.min(
        maxScrollLeft,
        Math.max(0, targetX * nextScale - container.clientWidth / 2),
      );
      const nextTop = Math.min(
        maxScrollTop,
        Math.max(0, targetY * nextScale - container.clientHeight / 2),
      );
      container.scrollTo({ left: nextLeft, top: nextTop, behavior: "smooth" });
    },
    [svgWidth, svgHeight],
  );

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
  const selectedNode =
    data?.nodes.find((n) => n.id === selectedId && visibleNodeIds.has(n.id)) ?? null;
  const nodeIndex = useMemo(() => {
    if (!data) return new Map<string, DependencyNode>();
    return new Map(data.nodes.map((node) => [node.id, node]));
  }, [data]);

  // Compute blocked by (unmet dependencies)
  const blockedBy = useMemo(() => {
    if (!selectedNode || !data) return [];
    return selectedNode.dependsOn.filter((depId) => {
      const dep = nodeIndex.get(depId);
      return dep && dep.status !== "done";
    });
  }, [selectedNode, nodeIndex, data]);

  const scaledWidth = svgWidth * scale;
  const scaledHeight = svgHeight * scale;
  const zoomPercent = Math.round(scale * 100);
  const minimapScale = Math.min(1, MINIMAP_WIDTH / svgWidth, MINIMAP_HEIGHT / svgHeight);
  const minimapWidth = svgWidth * minimapScale;
  const minimapHeight = svgHeight * minimapScale;
  const viewportRect = {
    x: Math.max(0, Math.min(viewport.x, svgWidth)),
    y: Math.max(0, Math.min(viewport.y, svgHeight)),
    width: Math.min(viewport.width, svgWidth),
    height: Math.min(viewport.height, svgHeight),
  };

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      {/* Floating header */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, pointerEvents: "auto" }}>
          {onClose && (
            <button
              className="btn"
              onClick={onClose}
              style={{ padding: "8px 16px", backgroundColor: "#ef4444" }}
            >
              ✕ Close
            </button>
          )}
          <div style={{ fontWeight: 700, color: "#fff", textShadow: "0 2px 4px rgba(0,0,0,0.5)" }}>
            Tech Tree
          </div>
          <div style={{ color: "#888", fontSize: 13 }}>
            {nodeCountLabel}
          </div>
          {data.cycles.length > 0 && (
            <div className="error" style={{ fontSize: 13 }}>
              {data.cycles.length} cycle{data.cycles.length > 1 ? "s" : ""} detected
            </div>
          )}
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
            pointerEvents: "auto",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          {/* View mode toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginRight: 8 }}>
            <button
              className={viewMode === "depth" ? "btn" : "btnSecondary"}
              onClick={() => setViewMode("depth")}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              Depth
            </button>
            <button
              className={viewMode === "era" ? "btn" : "btnSecondary"}
              onClick={() => setViewMode("era")}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              Era
            </button>
          </div>
          {trackOptions.length > 0 && (
            <TechTreeFilters
              tracks={trackOptions}
              selectedTrackIds={visibleTrackIds}
              onToggleTrack={toggleTrackVisibility}
              onSelectAll={showAllTracks}
              onClear={hideAllTracks}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className={swimlanesEnabled ? "btn" : "btnSecondary"}
              onClick={() => setSwimlanesEnabled((prev) => !prev)}
              style={{ padding: "4px 10px", fontSize: 11 }}
            >
              Swimlanes {swimlanesEnabled ? "On" : "Off"}
            </button>
            {swimlanesEnabled && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#9ca3af" }}>
                Sort
                <select
                  className="select"
                  value={swimlaneSort}
                  onChange={(event) => setSwimlaneSort(event.target.value as SwimlaneSortMode)}
                  style={{ fontSize: 11, padding: "4px 8px" }}
                >
                  <option value="manual">Manual order</option>
                  <option value="activity">Most recent activity</option>
                  <option value="count">Most WOs</option>
                  <option value="alpha">Alphabetical</option>
                </select>
              </label>
            )}
          </div>
          {/* Legend */}
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <div key={status} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 10, height: 10, backgroundColor: color, borderRadius: 2 }} />
              <span style={{ fontSize: 11, color: "#aaa" }}>{STATUS_LABELS[status as WorkOrderStatus]}</span>
            </div>
          ))}
          {viewMode === "era" && eraColumns.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 10 }}>
              {eraColumns.map((lane) => (
                <div key={lane.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      backgroundColor: lane.color,
                      borderRadius: 2,
                      opacity: 0.6,
                    }}
                  />
                  <span style={{ fontSize: 11, color: "#aaa" }}>{lane.label}</span>
                </div>
              ))}
            </div>
          )}
          {viewMode === "depth" && (
            <span style={{ fontSize: 11, color: "#aaa", marginLeft: 10 }}>
              {maxDepth + 1} depth levels
            </span>
          )}
          <button className="btnSecondary" onClick={() => void load()} style={{ marginLeft: 12 }}>
            Refresh
          </button>
        </div>
      </div>
      {trackOptions.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 64,
            left: 16,
            zIndex: 9,
            pointerEvents: "auto",
          }}
        >
          <div className="card" style={{ padding: "8px 10px", maxWidth: 360 }}>
            <TechTreeLegend
              tracks={trackOptions}
              selectedTrackIds={visibleTrackIds}
              onToggleTrack={toggleTrackVisibility}
            />
          </div>
        </div>
      )}

      {/* Full-screen SVG Graph */}
      <div
        ref={containerRef}
        onScroll={updateViewport}
        onWheel={handleWheel}
        style={{
          flex: 1,
          overflow: "auto",
          backgroundColor: "#0a0a14",
          backgroundImage: "radial-gradient(circle, #1a1a2e 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        <div style={{ width: scaledWidth, height: scaledHeight }}>
          <svg
            width={svgWidth}
            height={svgHeight}
            style={{
              display: "block",
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              transition: "transform 160ms ease-out",
              willChange: "transform",
            }}
          >
            {/* Era lanes - only in era view mode */}
            {viewMode === "era" && eraColumns.map((lane) => (
              <rect
                key={`era-bg-${lane.id}`}
                x={lane.x}
                y={0}
                width={lane.width}
                height={svgHeight}
                fill={lane.color}
                opacity={0.06}
              />
            ))}

            {/* Era labels - only in era view mode */}
            {viewMode === "era" && eraColumns.map((lane) => (
              <text
                key={`era-label-${lane.id}`}
                x={lane.x + NODE_WIDTH / 2}
                y={TOP_PADDING - 18}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={12}
                fontWeight={600}
              >
                {lane.label}
              </text>
            ))}

            {/* Depth labels - only in depth view mode */}
            {viewMode === "depth" && Array.from({ length: maxDepth + 1 }, (_, i) => (
              <text
                key={`depth-label-${i}`}
                x={LEFT_PADDING + i * (NODE_WIDTH + HORIZONTAL_GAP) + NODE_WIDTH / 2}
                y={TOP_PADDING - 18}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize={12}
                fontWeight={600}
              >
                Depth {i}
              </text>
            ))}

            <TechTreeSwimlanes
              lanes={lanes}
              svgWidth={svgWidth}
              isTrackVisible={isLaneVisible}
              onToggleLane={swimlanesEnabled ? toggleLane : undefined}
              showBackgrounds={swimlanesEnabled}
              showHeaders={false}
            />

            {/* Edges */}
            {data.nodes.map((node) => {
              const nodeVisible = visibleNodeIds.has(node.id);

              return node.dependsOn.map((depId) => {
                const depVisible = visibleNodeIds.has(depId);
                if (!nodeVisible && !depVisible) return null;
                const depNode = nodeIndex.get(depId);
                const isCrossProject = depNode
                  ? depNode.projectId !== repoId
                  : depId.includes(":");

                const isHighlightedDep = focusId === node.id && highlightedDeps.has(depId);
                const isHighlightedDependent = focusId === depId && highlightedDependents.has(node.id);
                const isHighlighted = isHighlightedDep || isHighlightedDependent;
                const isDimmed = focusId && !isHighlighted && focusId !== node.id && focusId !== depId;
                const isHiddenEdge = nodeVisible !== depVisible;
                let path = "";

                if (isHiddenEdge) {
                  const visibleId = nodeVisible ? node.id : depId;
                  const hiddenId = nodeVisible ? depId : node.id;
                  const visiblePos = nodePositions.get(visibleId);
                  if (!visiblePos) return null;
                  const hiddenX = nodeXPositions.get(hiddenId) ?? visiblePos.x;
                  const anchorX = hiddenX < visiblePos.x ? visiblePos.x : visiblePos.x + NODE_WIDTH;
                  const stubStartX =
                    hiddenX < visiblePos.x ? anchorX - HIDDEN_EDGE_STUB : anchorX + HIDDEN_EDGE_STUB;
                  const y = visiblePos.y + NODE_HEIGHT / 2;
                  path = `M ${stubStartX} ${y} L ${anchorX} ${y}`;
                } else {
                  const to = nodePositions.get(node.id);
                  const from = nodePositions.get(depId);
                  if (!to || !from) return null;
                  const x1 = from.x + NODE_WIDTH;
                  const y1 = from.y + NODE_HEIGHT / 2;
                  const x2 = to.x;
                  const y2 = to.y + NODE_HEIGHT / 2;
                  const midX = (x1 + x2) / 2;
                  path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
                }

                let stroke = isCrossProject ? "#3b82f6" : "#555";
                if (isHighlightedDep) stroke = "#22c55e";
                if (isHighlightedDependent) stroke = "#3b82f6";
                const hiddenOpacity = isHighlighted ? 0.6 : 0.35;
                const opacity = isHiddenEdge
                  ? isDimmed
                    ? 0.15
                    : hiddenOpacity
                  : isDimmed
                    ? 0.2
                    : 1;

                return (
                  <path
                    key={`${depId}-${node.id}`}
                    d={path}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isHighlighted ? 3 : 1.5}
                    strokeDasharray={isHiddenEdge || isCrossProject ? "6 4" : undefined}
                    opacity={opacity}
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
              if (!visibleNodeIds.has(node.id)) return null;
              const pos = nodePositions.get(node.id);
              if (!pos) return null;

              const isSelected = selectedId === node.id;
              const isHovered = hoveredId === node.id;
              const isFocus = focusId === node.id;
              const isHighlighted = highlightedDeps.has(node.id) || highlightedDependents.has(node.id);
              const isDimmed = focusId && !isFocus && !isHighlighted;
              const inCycle = nodesInCycles.has(node.id);
              const showProjectName = node.isExternal && (isHovered || isSelected);

              const statusColor = STATUS_COLORS[node.status];
              const trackId = nodeTrackIds.get(node.id) ?? UNASSIGNED_LANE_ID;
              const primaryTrack = (node.tracks ?? [])[0] ?? node.track ?? null;
              const trackColor =
                primaryTrack?.color ?? trackColorById.get(trackId) ?? DEFAULT_TRACK_COLOR;
              const nodeFill = trackTint(trackColor);
              const strokeColor = inCycle
                ? "#ef4444"
                : isSelected
                  ? "#fff"
                  : isHovered
                    ? "#888"
                    : trackColor || "#444";

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
                    fill={nodeFill}
                    stroke={strokeColor}
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
                    {(node.era ?? "Unassigned") + " - "}
                    {node.dependsOn.length} deps - {node.dependents.length} unlocks
                  </text>

                  {showProjectName && (
                    <text x={14} y={72} fill="#60a5fa" fontSize={10}>
                      {node.projectName}
                    </text>
                  )}

                  {/* Cycle warning icon */}
                  {inCycle && (
                    <text x={NODE_WIDTH - 20} y={NODE_HEIGHT - 8} fill="#ef4444" fontSize={14}>
                      !
                    </text>
                  )}
                </g>
              );
            })}

            <TechTreeSwimlanes
              lanes={lanes}
              svgWidth={svgWidth}
              isTrackVisible={isLaneVisible}
              onToggleLane={swimlanesEnabled ? toggleLane : undefined}
              showBackgrounds={false}
              showHeaders={swimlanesEnabled}
            />
          </svg>
        </div>
      </div>

      {/* Zoom + Minimap */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          zIndex: 9,
          pointerEvents: "auto",
        }}
      >
        <div className="card" style={{ padding: 8, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <button
              className="btnSecondary"
              onClick={zoomOut}
              style={{ padding: "6px 10px", minWidth: 32 }}
              aria-label="Zoom out"
              title="Zoom out (-)"
            >
              -
            </button>
            <div style={{ fontSize: 12, color: "#e5e7eb", minWidth: 54, textAlign: "center" }}>
              {zoomPercent}%
            </div>
            <button
              className="btnSecondary"
              onClick={zoomIn}
              style={{ padding: "6px 10px", minWidth: 32 }}
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              +
            </button>
            <button
              className="btnSecondary"
              onClick={fitToScreen}
              style={{ padding: "6px 10px" }}
              title="Fit to screen"
            >
              Fit
            </button>
            <button
              className="btnSecondary"
              onClick={resetZoom}
              style={{ padding: "6px 10px" }}
              title="Reset zoom (0)"
            >
              Reset
            </button>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>Ctrl/Cmd + Scroll to zoom</div>
        </div>

        <div className="card" style={{ padding: 8 }}>
          <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 6 }}>Overview</div>
          <div
            style={{
              width: MINIMAP_WIDTH,
              height: MINIMAP_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#0f1320",
              borderRadius: 10,
              border: "1px solid #232a3d",
            }}
          >
            <svg
              width={minimapWidth}
              height={minimapHeight}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              onClick={handleMinimapClick}
              style={{ cursor: "pointer" }}
            >
              {data.nodes.map((node) => {
                if (!visibleNodeIds.has(node.id)) return null;
                const pos = nodePositions.get(node.id);
                if (!pos) return null;
                return (
                  <rect
                    key={`minimap-${node.id}`}
                    x={pos.x}
                    y={pos.y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={6}
                    fill={STATUS_COLORS[node.status]}
                    opacity={0.65}
                  />
                );
              })}
              {viewportRect.width > 0 && viewportRect.height > 0 && (
                <rect
                  x={viewportRect.x}
                  y={viewportRect.y}
                  width={viewportRect.width}
                  height={viewportRect.height}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={3}
                />
              )}
            </svg>
          </div>
        </div>
      </div>

        {/* Detail Panel - Floating */}
        {selectedNode && (
          <section
            className="card"
            style={{
              position: "absolute",
              top: 70,
              right: 16,
              width: 300,
              maxHeight: "calc(100vh - 100px)",
              overflow: "auto",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div className="muted" style={{ fontSize: 12 }}>{selectedNode.id}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{selectedNode.title}</div>
                {selectedNode.isExternal && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Project: {selectedNode.projectName}
                  </div>
                )}
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
              <span className="badge" style={{ marginLeft: 6 }}>
                {selectedNode.era ?? "Unassigned"}
              </span>
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
              {(() => {
                const rawId = selectedNode.id;
                const colonIndex = rawId.indexOf(":");
                const workOrderId =
                  selectedNode.isExternal && colonIndex >= 0
                    ? rawId.slice(colonIndex + 1)
                    : rawId;
                const targetProjectId = selectedNode.isExternal
                  ? selectedNode.projectId
                  : repoId;
                const label = selectedNode.isExternal
                  ? "Open External Work Order"
                  : "Open Work Order";
                return (
                  <Link
                    href={`/projects/${encodeURIComponent(targetProjectId)}/work-orders/${encodeURIComponent(workOrderId)}`}
                    className="btn"
                    style={{ width: "100%", textAlign: "center", display: "block" }}
                    onClick={onClose}
                  >
                    {label}
                  </Link>
                );
              })()}
            </div>
          </section>
        )}
    </div>
  );
}

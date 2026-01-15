"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
  type WheelEventHandler,
} from "react";
import type { VisualizationNode } from "./types";

export type CanvasTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

type TooltipPosition = { x: number; y: number } | null;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
};

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.8;
const DRAG_THRESHOLD = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getCanvasPoint(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToWorld(point: { x: number; y: number }, transform: CanvasTransform) {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  };
}

export function useCanvasInteraction({
  canvasRef,
  nodes,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  nodes: VisualizationNode[];
}): {
  transform: CanvasTransform;
  setTransform: React.Dispatch<React.SetStateAction<CanvasTransform>>;
  selectedNode: VisualizationNode | null;
  hoveredNode: VisualizationNode | null;
  tooltipPosition: TooltipPosition;
  isPanning: boolean;
  handlers: {
    onPointerDown: PointerEventHandler<HTMLCanvasElement>;
    onPointerMove: PointerEventHandler<HTMLCanvasElement>;
    onPointerUp: PointerEventHandler<HTMLCanvasElement>;
    onPointerLeave: PointerEventHandler<HTMLCanvasElement>;
    onWheel: WheelEventHandler<HTMLCanvasElement>;
  };
} {
  const [transform, setTransform] = useState<CanvasTransform>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>(null);
  const [isPanning, setIsPanning] = useState(false);
  const dragState = useRef<DragState | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedId) ?? null,
    [nodes, selectedId]
  );
  const hoveredNode = useMemo(
    () => nodes.find((node) => node.id === hoveredId) ?? null,
    [nodes, hoveredId]
  );

  useEffect(() => {
    if (selectedId && !selectedNode) setSelectedId(null);
    if (hoveredId && !hoveredNode) setHoveredId(null);
  }, [selectedId, selectedNode, hoveredId, hoveredNode]);

  const findNodeAtPoint = useCallback(
    (worldPoint: { x: number; y: number }) => {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i];
        if (node.x === undefined || node.y === undefined) continue;
        const radius = node.radius ?? 16;
        const dx = worldPoint.x - node.x;
        const dy = worldPoint.y - node.y;
        if (node.type === "work_order") {
          if (Math.abs(dx) <= radius && Math.abs(dy) <= radius) return node;
        } else if (dx * dx + dy * dy <= radius * radius) {
          return node;
        }
      }
      return null;
    },
    [nodes]
  );

  const onPointerDown = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      if (event.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(event.pointerId);
      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      };
      setIsPanning(true);
    },
    [canvasRef]
  );

  const onPointerMove = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const activeDrag = dragState.current;
      if (activeDrag && activeDrag.pointerId === event.pointerId) {
        const dx = event.clientX - activeDrag.lastX;
        const dy = event.clientY - activeDrag.lastY;
        activeDrag.lastX = event.clientX;
        activeDrag.lastY = event.clientY;

        const distance = Math.hypot(
          event.clientX - activeDrag.startX,
          event.clientY - activeDrag.startY
        );
        if (distance > DRAG_THRESHOLD) {
          activeDrag.moved = true;
        }

        if (activeDrag.moved) {
          setTransform((prev) => ({
            ...prev,
            offsetX: prev.offsetX + dx,
            offsetY: prev.offsetY + dy,
          }));
          setTooltipPosition(null);
          return;
        }
      }

      const point = getCanvasPoint(event, canvas);
      const worldPoint = screenToWorld(point, transform);
      const node = findNodeAtPoint(worldPoint);
      setHoveredId(node?.id ?? null);
      setTooltipPosition(node ? { x: point.x, y: point.y } : null);
    },
    [canvasRef, findNodeAtPoint, transform]
  );

  const onPointerUp = useCallback<PointerEventHandler<HTMLCanvasElement>>(
    (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const activeDrag = dragState.current;
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;

      dragState.current = null;
      setIsPanning(false);
      canvas.releasePointerCapture(event.pointerId);

      if (activeDrag.moved) return;

      const point = getCanvasPoint(event, canvas);
      const worldPoint = screenToWorld(point, transform);
      const node = findNodeAtPoint(worldPoint);
      setSelectedId(node?.id ?? null);
    },
    [canvasRef, findNodeAtPoint, transform]
  );

  const onPointerLeave = useCallback<PointerEventHandler<HTMLCanvasElement>>(() => {
    setHoveredId(null);
    setTooltipPosition(null);
    if (dragState.current) {
      dragState.current = null;
      setIsPanning(false);
    }
  }, []);

  const onWheel = useCallback<WheelEventHandler<HTMLCanvasElement>>(
    (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      event.preventDefault();
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      const point = getCanvasPoint(event, canvas);
      setTransform((prev) => {
        const nextScale = clamp(prev.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
        const worldPoint = screenToWorld(point, prev);
        const offsetX = point.x - worldPoint.x * nextScale;
        const offsetY = point.y - worldPoint.y * nextScale;
        return { ...prev, scale: nextScale, offsetX, offsetY };
      });
    },
    [canvasRef]
  );

  return {
    transform,
    setTransform,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
      onWheel,
    },
  };
}

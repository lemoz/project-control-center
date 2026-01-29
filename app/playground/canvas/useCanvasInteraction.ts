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
  mode: "pan" | "node";
  nodeId?: string;
  nodeOffset?: { x: number; y: number };
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
  onNodeDragStart,
  onNodeDrag,
  onNodeDragEnd,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  nodes: VisualizationNode[];
  onNodeDragStart?: (node: VisualizationNode, point: { x: number; y: number }) => void;
  onNodeDrag?: (node: VisualizationNode, point: { x: number; y: number }) => void;
  onNodeDragEnd?: (node: VisualizationNode) => void;
}): {
  transform: CanvasTransform;
  setTransform: React.Dispatch<React.SetStateAction<CanvasTransform>>;
  selectedNode: VisualizationNode | null;
  hoveredNode: VisualizationNode | null;
  tooltipPosition: TooltipPosition;
  isPanning: boolean;
  clearSelection: () => void;
  selectNode: (nodeId: string | null) => void;
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
  const clearSelection = useCallback(() => setSelectedId(null), []);
  const selectNode = useCallback((nodeId: string | null) => setSelectedId(nodeId), []);

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
      const point = getCanvasPoint(event, canvas);
      const worldPoint = screenToWorld(point, transform);
      const dragNode =
        onNodeDrag ? findNodeAtPoint(worldPoint) : null;
      canvas.setPointerCapture(event.pointerId);
      dragState.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        mode: dragNode ? "node" : "pan",
        nodeId: dragNode?.id,
        nodeOffset:
          dragNode && dragNode.x !== undefined && dragNode.y !== undefined
            ? { x: worldPoint.x - dragNode.x, y: worldPoint.y - dragNode.y }
            : { x: 0, y: 0 },
      };
      if (dragNode) {
        const offset =
          dragNode.x !== undefined && dragNode.y !== undefined
            ? { x: worldPoint.x - dragNode.x, y: worldPoint.y - dragNode.y }
            : { x: 0, y: 0 };
        onNodeDragStart?.(dragNode, {
          x: worldPoint.x - offset.x,
          y: worldPoint.y - offset.y,
        });
        setHoveredId(dragNode.id);
        setTooltipPosition(null);
      }
      setIsPanning(true);
    },
    [canvasRef, findNodeAtPoint, onNodeDrag, onNodeDragStart, transform]
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

        if (activeDrag.mode === "node") {
          const point = getCanvasPoint(event, canvas);
          const worldPoint = screenToWorld(point, transform);
          const node = nodes.find((item) => item.id === activeDrag.nodeId) ?? null;
          if (node) {
            const offset = activeDrag.nodeOffset ?? { x: 0, y: 0 };
            onNodeDrag?.(node, {
              x: worldPoint.x - offset.x,
              y: worldPoint.y - offset.y,
            });
          }
          setTooltipPosition(null);
          return;
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
    [canvasRef, findNodeAtPoint, nodes, onNodeDrag, transform]
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

      if (activeDrag.mode === "node") {
        const node = nodes.find((item) => item.id === activeDrag.nodeId) ?? null;
        if (node) {
          onNodeDragEnd?.(node);
          setSelectedId(node.id);
        }
        return;
      }

      if (activeDrag.moved) return;

      const point = getCanvasPoint(event, canvas);
      const worldPoint = screenToWorld(point, transform);
      const node = findNodeAtPoint(worldPoint);
      setSelectedId(node?.id ?? null);
    },
    [canvasRef, findNodeAtPoint, nodes, onNodeDragEnd, transform]
  );

  const onPointerLeave = useCallback<PointerEventHandler<HTMLCanvasElement>>(() => {
    setHoveredId(null);
    setTooltipPosition(null);
    const activeDrag = dragState.current;
    if (activeDrag) {
      if (activeDrag.mode === "node") {
        const node = nodes.find((item) => item.id === activeDrag.nodeId) ?? null;
        if (node) {
          onNodeDragEnd?.(node);
        }
      }
      const canvas = canvasRef.current;
      if (canvas) {
        try {
          canvas.releasePointerCapture(activeDrag.pointerId);
        } catch {
          // Ignore invalid pointer capture release
        }
      }
      dragState.current = null;
      setIsPanning(false);
    }
  }, [canvasRef, nodes, onNodeDragEnd]);

  const onWheel = useCallback<WheelEventHandler<HTMLCanvasElement>>(
    () => {
      // Scroll-to-zoom disabled — use +/- buttons instead
    },
    []
  );

  return {
    transform,
    setTransform,
    selectedNode,
    hoveredNode,
    tooltipPosition,
    isPanning,
    clearSelection,
    selectNode,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerLeave,
      onWheel,
    },
  };
}

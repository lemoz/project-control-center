"use client";

import { useEffect, useState } from "react";

type CanvasVoiceNode = {
  id: string;
  type: "project" | "work_order";
  label: string;
  title?: string;
  projectId?: string;
  workOrderId?: string;
};

type CanvasVoiceState = {
  contextLabel?: string;
  focusedNode: CanvasVoiceNode | null;
  selectedNode: CanvasVoiceNode | null;
  visibleProjects: CanvasVoiceNode[];
  visibleWorkOrders: CanvasVoiceNode[];
  highlightedWorkOrderId: string | null;
  detailPanelOpen: boolean;
  updatedAt: number;
};

type CanvasVoiceCommand =
  | { type: "focusNode"; nodeId: string }
  | { type: "highlightWorkOrder"; workOrderId: string }
  | { type: "toggleDetailPanel"; open: boolean };

type CanvasVoiceListener = (state: CanvasVoiceState) => void;

type CanvasCommandListener = (command: CanvasVoiceCommand) => void;

const stateListeners = new Set<CanvasVoiceListener>();
const commandListeners = new Set<CanvasCommandListener>();

let canvasVoiceState: CanvasVoiceState = {
  contextLabel: "Canvas",
  focusedNode: null,
  selectedNode: null,
  visibleProjects: [],
  visibleWorkOrders: [],
  highlightedWorkOrderId: null,
  detailPanelOpen: true,
  updatedAt: 0,
};

function notifyStateListeners() {
  stateListeners.forEach((listener) => listener(canvasVoiceState));
}

export function getCanvasVoiceState(): CanvasVoiceState {
  return canvasVoiceState;
}

export function setCanvasVoiceState(next: Partial<CanvasVoiceState>): void {
  canvasVoiceState = {
    ...canvasVoiceState,
    ...next,
    updatedAt: Date.now(),
  };
  notifyStateListeners();
}

export function subscribeCanvasVoiceState(listener: CanvasVoiceListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function sendCanvasCommand(command: CanvasVoiceCommand): void {
  commandListeners.forEach((listener) => listener(command));
}

export function subscribeCanvasCommands(listener: CanvasCommandListener): () => void {
  commandListeners.add(listener);
  return () => commandListeners.delete(listener);
}

export function useCanvasVoiceState(): CanvasVoiceState {
  const [state, setState] = useState(getCanvasVoiceState());

  useEffect(() => subscribeCanvasVoiceState(setState), []);

  return state;
}

type FocusNodeArgs = { nodeId: string };

type HighlightWorkOrderArgs = { workOrderId: string };

type ToggleDetailPanelArgs = { open: boolean };

export function createVoiceClientTools() {
  return {
    focusNode: async ({ nodeId }: FocusNodeArgs) => {
      if (!nodeId || typeof nodeId !== "string") {
        return "Missing node id.";
      }
      sendCanvasCommand({ type: "focusNode", nodeId: nodeId.trim() });
      return "Focused node.";
    },
    highlightWorkOrder: async ({ workOrderId }: HighlightWorkOrderArgs) => {
      if (!workOrderId || typeof workOrderId !== "string") {
        return "Missing work order id.";
      }
      sendCanvasCommand({ type: "highlightWorkOrder", workOrderId: workOrderId.trim() });
      return "Highlighted work order.";
    },
    toggleDetailPanel: async ({ open }: ToggleDetailPanelArgs) => {
      if (typeof open !== "boolean") {
        return "Missing open state.";
      }
      sendCanvasCommand({ type: "toggleDetailPanel", open });
      return open ? "Detail panel opened." : "Detail panel closed.";
    },
  };
}

export type { CanvasVoiceNode, CanvasVoiceState, CanvasVoiceCommand };

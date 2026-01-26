"use client";

import { useEffect, useMemo } from "react";
import { setCanvasVoiceState, type CanvasVoiceNode } from "./voiceClientTools";

type LandingWorkOrder = {
  id: string;
  title: string;
};

type LandingProject = {
  id: string;
  name: string;
  nextWorkOrders?: LandingWorkOrder[];
};

type LandingVoiceContextBridgeProps = {
  projects: LandingProject[];
};

const MAX_CONTEXT_ITEMS = 12;

export function LandingVoiceContextBridge({ projects }: LandingVoiceContextBridgeProps) {
  const visibleProjects = useMemo<CanvasVoiceNode[]>(
    () =>
      projects.slice(0, MAX_CONTEXT_ITEMS).map((project) => ({
        id: project.id,
        type: "project",
        label: project.name,
        projectId: project.id,
      })),
    [projects]
  );

  const visibleWorkOrders = useMemo<CanvasVoiceNode[]>(() => {
    const items: CanvasVoiceNode[] = [];
    for (const project of projects) {
      for (const workOrder of project.nextWorkOrders ?? []) {
        items.push({
          id: `${project.id}:${workOrder.id}`,
          type: "work_order",
          label: workOrder.id,
          title: workOrder.title,
          projectId: project.id,
          workOrderId: workOrder.id,
        });
        if (items.length >= MAX_CONTEXT_ITEMS) {
          return items;
        }
      }
    }
    return items;
  }, [projects]);

  useEffect(() => {
    setCanvasVoiceState({
      contextLabel: "Portfolio",
      focusedNode: null,
      selectedNode: null,
      visibleProjects,
      visibleWorkOrders,
      highlightedWorkOrderId: null,
      detailPanelOpen: false,
    });
  }, [visibleProjects, visibleWorkOrders]);

  return null;
}

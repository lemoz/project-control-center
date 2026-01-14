import type { VisualizationDefinition } from "../types";
import { ActivityPulseVisualization } from "./ActivityPulseViz";
import { PlaceholderVisualization } from "./PlaceholderViz";
import { TimelineRiverVisualization } from "./TimelineRiverViz";

export const visualizations: VisualizationDefinition[] = [
  {
    id: "activity_pulse",
    name: "Activity Pulse",
    description: "Activity-driven pulse rings with glow.",
    create: () => new ActivityPulseVisualization(),
  },
  {
    id: "timeline_river",
    name: "Timeline River",
    description: "Runs flow through backlog to done across project lanes.",
    create: () => new TimelineRiverVisualization(),
  },
  {
    id: "placeholder",
    name: "Placeholder",
    description: "Grid layout to validate the shell.",
    create: () => new PlaceholderVisualization(),
  },
];

export const defaultVisualizationId = visualizations[0]?.id ?? "placeholder";

export function findVisualization(id: string): VisualizationDefinition {
  return visualizations.find((viz) => viz.id === id) ?? visualizations[0];
}

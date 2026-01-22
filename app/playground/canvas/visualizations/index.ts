import type { VisualizationDefinition } from "../types";
import { ActivityPulseVisualization } from "./ActivityPulseViz";
import { ForceGraphVisualization } from "./ForceGraphViz";
import { HeatmapGridVisualization } from "./HeatmapGridViz";
import { OrbitalGravityVisualization } from "./OrbitalGravityViz";
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
    id: "force_graph",
    name: "Force-Directed Graph",
    description: "Physics-based layout of projects and work orders.",
    create: () => new ForceGraphVisualization(),
  },
  {
    id: "heatmap_grid",
    name: "Heatmap Grid",
    description: "Dense grid of WO tiles colored by status and activity.",
    create: () => new HeatmapGridVisualization(),
  },
  {
    id: "orbital_gravity",
    name: "Orbital Gravity",
    description: "Attention gravity with orbiting project nodes.",
    create: () => new OrbitalGravityVisualization(),
  },
  {
    id: "orbital_work_orders",
    name: "Orbital Work Orders",
    description: "Status-ring orbit of work orders.",
    create: () =>
      new OrbitalGravityVisualization({ mode: "work-orders", filter: "active" }),
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

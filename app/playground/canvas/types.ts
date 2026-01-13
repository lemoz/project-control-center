export type ProjectStatus = "active" | "blocked" | "parked";

export type VisualizationNodeType = "project" | "work_order" | "run";

export type VisualizationEdge = {
  source: string;
  target: string;
  type: string;
};

export type ProjectNode = {
  id: string;
  type: VisualizationNodeType;
  label: string;
  name: string;
  path: string;
  status: ProjectStatus;
  consumptionRate: number;
  isActive: boolean;
  activityLevel: number;
  lastActivity: Date | null;
  needsHuman: boolean;
  escalationCount: number;
  escalationSummary?: string;
  health: number;
  progress: number;
  successProgress: number;
  workOrders: {
    ready: number;
    building: number;
    blocked: number;
    done: number;
  };
  parentId?: string;
  dependsOn: string[];
  x?: number;
  y?: number;
  radius?: number;
};

export type VisualizationNode = ProjectNode;

export type VisualizationData = {
  nodes: ProjectNode[];
  edges: VisualizationEdge[];
  timestamp: Date;
};

export interface Visualization {
  id: string;
  name: string;
  description: string;

  init(canvas: HTMLCanvasElement, data: VisualizationData): void;
  update(data: VisualizationData): void;
  render(): void;
  destroy(): void;

  onNodeClick?(node: VisualizationNode): void;
  onNodeHover?(node: VisualizationNode | null): void;
}

export type VisualizationDefinition = {
  id: string;
  name: string;
  description: string;
  create: () => Visualization;
};

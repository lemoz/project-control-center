export type ProjectStatus = "active" | "blocked" | "parked";
export type ProjectHealthStatus =
  | "healthy"
  | "attention_needed"
  | "stalled"
  | "failing"
  | "blocked";

export type GlobalAgentSessionState =
  | "onboarding"
  | "briefing"
  | "autonomous"
  | "debrief"
  | "ended";

export type GlobalAgentSessionSummary = {
  id: string;
  state: GlobalAgentSessionState;
  paused_at: string | null;
  autonomous_started_at: string | null;
  updated_at: string;
};

export type VisualizationNodeType = "project" | "work_order" | "run";

export type WorkOrderStatus =
  | "backlog"
  | "ready"
  | "building"
  | "ai_review"
  | "you_review"
  | "done"
  | "blocked"
  | "parked";

export type VisualizationEdge = {
  source: string;
  target: string;
  type: string;
};

export type ProjectNode = {
  id: string;
  type: "project";
  label: string;
  name: string;
  path: string;
  status: ProjectStatus;
  priority: number;
  consumptionRate: number;
  isActive: boolean;
  hasActiveShift?: boolean;
  activePhase?: "building" | "testing" | "reviewing" | "waiting";
  activityLevel: number;
  lastActivity: Date | null;
  needsHuman: boolean;
  escalationCount: number;
  escalationSummary?: string;
  health: number;
  healthStatus?: ProjectHealthStatus;
  progress: number;
  successProgress: number;
  workOrders: {
    ready: number;
    building: number;
    blocked: number;
    done: number;
  };
  era?: string | null;
  parentId?: string;
  dependsOn: string[];
  x?: number;
  y?: number;
  radius?: number;
};

export type WorkOrderNode = {
  id: string;
  type: "work_order";
  workOrderId: string;
  label: string;
  title: string;
  status: WorkOrderStatus;
  priority: number;
  estimateHours: number | null;
  trackId: string | null;
  track: { id: string; name: string; color: string | null } | null;
  era: string | null;
  projectId: string;
  projectName: string;
  lastActivity: Date | null;
  activityLevel: number;
  isActive: boolean;
  x?: number;
  y?: number;
  radius?: number;
};

export type VisualizationNode = ProjectNode | WorkOrderNode;

export type RunStatus =
  | "queued"
  | "baseline_failed"
  | "building"
  | "waiting_for_input"
  | "ai_review"
  | "testing"
  | "you_review"
  | "merged"
  | "merge_conflict"
  | "failed"
  | "canceled";

export type RunSummary = {
  id: string;
  work_order_id: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  escalation: string | null;
};

export type VisualizationData = {
  nodes: ProjectNode[];
  edges: VisualizationEdge[];
  timestamp: Date;
  runsByProject?: Record<string, RunSummary[]>;
  workOrderNodes?: WorkOrderNode[];
  globalSession?: GlobalAgentSessionSummary | null;
};

export interface Visualization {
  id: string;
  name: string;
  description: string;

  init(canvas: HTMLCanvasElement, data: VisualizationData): void;
  update(data: VisualizationData): void;
  render(): void;
  destroy(): void;

  onNodeClick?(node: VisualizationNode | null): void;
  onNodeHover?(node: VisualizationNode | null): void;
  onNodeDragStart?(node: VisualizationNode, point: { x: number; y: number }): void;
  onNodeDrag?(node: VisualizationNode, point: { x: number; y: number }): void;
  onNodeDragEnd?(node: VisualizationNode): void;
}

export type VisualizationDefinition = {
  id: string;
  name: string;
  description: string;
  create: () => Visualization;
};

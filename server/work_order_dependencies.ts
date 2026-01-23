import { findProjectById, listProjects, type ProjectRow } from "./db.js";
import { listWorkOrders, type WorkOrder, type WorkOrderStatus } from "./work_orders.js";

export type ResolvedDependency = {
  project_id: string;
  work_order_id: string;
  status: WorkOrderStatus | "not_found";
  satisfied: boolean;
  is_cross_project: boolean;
};

export type DependencyBlocker = {
  project: string;
  wo: string;
  status: string;
};

export type WorkOrderLookup = {
  project: ProjectRow;
  workOrders: WorkOrder[];
  byId: Map<string, WorkOrder>;
};

type ParsedDependency = {
  projectId: string;
  workOrderId: string;
  isCrossProject: boolean;
};

export function parseDependencyRef(
  raw: string,
  currentProjectId: string
): ParsedDependency {
  const trimmed = raw.trim();
  const colonIndex = trimmed.indexOf(":");
  if (colonIndex > 0 && colonIndex < trimmed.length - 1) {
    const projectId = trimmed.slice(0, colonIndex).trim();
    const workOrderId = trimmed.slice(colonIndex + 1).trim();
    if (projectId && workOrderId) {
      return {
        projectId,
        workOrderId,
        isCrossProject: projectId !== currentProjectId,
      };
    }
  }
  return {
    projectId: currentProjectId,
    workOrderId: trimmed,
    isCrossProject: false,
  };
}

export function normalizeDependencyId(raw: string, currentProjectId: string): string {
  const parsed = parseDependencyRef(raw, currentProjectId);
  if (!parsed.workOrderId) return raw.trim();
  if (parsed.projectId === currentProjectId) return parsed.workOrderId;
  return `${parsed.projectId}:${parsed.workOrderId}`;
}

export function buildWorkOrderLookup(
  project: ProjectRow,
  workOrders?: WorkOrder[]
): WorkOrderLookup {
  const list = workOrders ?? listWorkOrders(project.path);
  const byId = new Map(list.map((wo) => [wo.id, wo]));
  return { project, workOrders: list, byId };
}

export function buildDependencyLookups(
  currentProject: ProjectRow,
  workOrders: WorkOrder[]
): Map<string, WorkOrderLookup> {
  const lookups = new Map<string, WorkOrderLookup>();
  lookups.set(currentProject.id, buildWorkOrderLookup(currentProject, workOrders));

  const crossProjectIds = new Set<string>();
  for (const wo of workOrders) {
    for (const dep of wo.depends_on) {
      const parsed = parseDependencyRef(dep, currentProject.id);
      if (parsed.isCrossProject) crossProjectIds.add(parsed.projectId);
    }
  }

  for (const projectId of crossProjectIds) {
    const project = findProjectById(projectId);
    if (!project) continue;
    lookups.set(projectId, buildWorkOrderLookup(project));
  }

  return lookups;
}

export function buildGlobalWorkOrderLookups(): Map<string, WorkOrderLookup> {
  const lookups = new Map<string, WorkOrderLookup>();
  for (const project of listProjects()) {
    lookups.set(project.id, buildWorkOrderLookup(project));
  }
  return lookups;
}

export function resolveWorkOrderDependencies(
  workOrder: WorkOrder,
  currentProjectId: string,
  lookups: Map<string, WorkOrderLookup>
): ResolvedDependency[] {
  return workOrder.depends_on.map((dep) => {
    const parsed = parseDependencyRef(dep, currentProjectId);
    const lookup = lookups.get(parsed.projectId);
    const status = lookup?.byId.get(parsed.workOrderId)?.status ?? "not_found";
    return {
      project_id: parsed.projectId,
      work_order_id: parsed.workOrderId,
      status,
      satisfied: status === "done",
      is_cross_project: parsed.isCrossProject,
    };
  });
}

export function summarizeResolvedDependencies(resolved: ResolvedDependency[]): {
  depsSatisfied: boolean;
  blockedByCrossProject: boolean;
  blockers: DependencyBlocker[];
} {
  const depsSatisfied = resolved.every((dep) => dep.satisfied);
  const blockers = resolved
    .filter((dep) => !dep.satisfied)
    .map((dep) => ({
      project: dep.project_id,
      wo: dep.work_order_id,
      status: dep.status,
    }));
  const blockedByCrossProject = resolved.some(
    (dep) => dep.is_cross_project && !dep.satisfied
  );
  return { depsSatisfied, blockedByCrossProject, blockers };
}

export function findWorkOrderFromLookups(
  lookups: Map<string, WorkOrderLookup>,
  projectId: string,
  workOrderId: string
): WorkOrder | null {
  const lookup = lookups.get(projectId);
  return lookup?.byId.get(workOrderId) ?? null;
}

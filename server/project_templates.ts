import fs from "fs";
import path from "path";
import { CONSTITUTION_TEMPLATE, writeProjectConstitution } from "./constitution.js";
import {
  updateProjectIsolationSettings,
  updateProjectLifecycleStatus,
  type ProjectIsolationMode,
  type ProjectIsolationSize,
  type ProjectLifecycleStatus,
  type ProjectRow,
} from "./db.js";
import { createWorkOrder, listWorkOrders, patchWorkOrder } from "./work_orders.js";

export type WorkOrderTemplate = {
  title: string;
  goal: string;
  priority?: number;
  tags?: string[];
  era?: string;
};

export type ProjectTemplateSettings = {
  isolation_mode?: ProjectIsolationMode;
  vm_size?: ProjectIsolationSize;
  lifecycle_status?: ProjectLifecycleStatus;
  status?: ProjectRow["status"];
  priority?: number;
};

export type ProjectTemplate = {
  name: string;
  description: string;
  initial_wos: WorkOrderTemplate[];
  constitution_base?: string;
  constitution?: string;
  default_settings?: ProjectTemplateSettings;
};

export type ProjectTemplateSummary = Omit<ProjectTemplate, "constitution">;

const WEB_APP_CONSTITUTION = `${CONSTITUTION_TEMPLATE.trimEnd()}

## Web App Defaults
- Prefer Next.js App Router and file-based routing conventions
- Add linting and formatting early
- Keep API layer typed and documented
`;

const WEB_APP_TEMPLATE: ProjectTemplate = {
  name: "web-app",
  description: "Full-stack web application",
  initial_wos: [
    {
      title: "Project Setup",
      goal: "Initialize repo, dependencies, and CI",
      priority: 2,
    },
    {
      title: "Core Architecture",
      goal: "Set up routing, state, and API layer",
      priority: 3,
    },
  ],
  constitution_base: "web-app",
  constitution: WEB_APP_CONSTITUTION,
  default_settings: {
    isolation_mode: "vm",
    vm_size: "medium",
    lifecycle_status: "active",
  },
};

const PROJECT_TEMPLATES: ProjectTemplate[] = [WEB_APP_TEMPLATE];

export function listProjectTemplates(): ProjectTemplateSummary[] {
  return PROJECT_TEMPLATES.map(({ constitution, ...template }) => template);
}

export function getProjectTemplate(name: string): ProjectTemplate | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return PROJECT_TEMPLATES.find((template) => template.name === normalized) ?? null;
}

export function applyProjectTemplate(params: {
  projectId: string;
  repoPath: string;
  template: ProjectTemplate;
}): { created_work_orders: string[] } {
  const existingWorkOrders = listWorkOrders(params.repoPath);
  const createdWorkOrders: string[] = [];
  if (existingWorkOrders.length === 0) {
    for (const item of params.template.initial_wos) {
      const created = createWorkOrder(params.repoPath, {
        title: item.title,
        priority: item.priority,
        tags: item.tags,
        era: item.era,
      });
      patchWorkOrder(params.repoPath, created.id, {
        goal: item.goal,
      });
      createdWorkOrders.push(created.id);
    }
  }

  const defaultSettings = params.template.default_settings;
  if (defaultSettings?.isolation_mode || defaultSettings?.vm_size) {
    updateProjectIsolationSettings(params.projectId, {
      isolation_mode: defaultSettings.isolation_mode,
      vm_size: defaultSettings.vm_size,
    });
  }
  if (defaultSettings?.lifecycle_status) {
    updateProjectLifecycleStatus(params.projectId, defaultSettings.lifecycle_status);
  }

  if (params.template.constitution) {
    const constitutionPath = path.join(params.repoPath, ".constitution.md");
    if (!fs.existsSync(constitutionPath)) {
      writeProjectConstitution(params.repoPath, params.template.constitution, {
        source: "template",
      });
    }
  }

  return { created_work_orders: createdWorkOrders };
}

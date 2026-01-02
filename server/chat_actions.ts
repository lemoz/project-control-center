import { z } from "zod";
import { findProjectById, getDb, setProjectHidden, setProjectStar } from "./db.js";
import {
  createChatActionLedgerEntry,
  getChatActionLedgerEntry,
  getChatMessageById,
  markChatActionUndone,
} from "./chat_db.js";
import { ChatActionSchema, type ChatAction } from "./chat_contract.js";
import { syncAndListRepoSummaries } from "./projects_catalog.js";
import { enqueueCodexRun } from "./runner_agent.js";
import {
  createWorkOrder,
  deleteWorkOrder,
  overwriteWorkOrderMarkdown,
  patchWorkOrder,
  readWorkOrderMarkdown,
  WORK_ORDER_STATUSES,
  type WorkOrderPatchInput,
} from "./work_orders.js";

const ApplyRequestSchema = z
  .object({
    messageId: z.string().min(1),
    actionIndex: z.number().int().min(0),
  })
  .strict();

export type ApplyChatActionRequest = z.infer<typeof ApplyRequestSchema>;

const ProjectSetStarPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    starred: z.boolean(),
  })
  .strict();

const ProjectSetHiddenPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    hidden: z.boolean(),
  })
  .strict();

const WorkOrderCreatePayloadSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

const WorkOrderPatchSchema: z.ZodType<WorkOrderPatchInput> = z
  .object({
    title: z.string().min(1).optional(),
    goal: z.string().nullable().optional(),
    context: z.array(z.string()).optional(),
    acceptance_criteria: z.array(z.string()).optional(),
    non_goals: z.array(z.string()).optional(),
    stop_conditions: z.array(z.string()).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    estimate_hours: z.number().nullable().optional(),
    status: z.enum(WORK_ORDER_STATUSES).optional(),
  })
  .strict()
  .partial();

const WorkOrderUpdatePayloadSchema = z
  .object({
    projectId: z.string().min(1),
    workOrderId: z.string().min(1),
    patch: WorkOrderPatchSchema,
  })
  .strict();

const WorkOrderSetStatusPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    workOrderId: z.string().min(1),
    status: z.enum(WORK_ORDER_STATUSES),
  })
  .strict();

const WorkOrderStartRunPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    workOrderId: z.string().min(1),
  })
  .strict();

type UndoPayload =
  | { type: "project_set_star"; payload: z.infer<typeof ProjectSetStarPayloadSchema> }
  | { type: "project_set_hidden"; payload: z.infer<typeof ProjectSetHiddenPayloadSchema> }
  | { type: "work_order_delete"; payload: { projectId: string; workOrderId: string } }
  | { type: "work_order_restore_markdown"; payload: { projectId: string; workOrderId: string; markdown: string } };

const UndoPayloadSchema: z.ZodType<UndoPayload> = z.union([
  z.object({ type: z.literal("project_set_star"), payload: ProjectSetStarPayloadSchema }).strict(),
  z
    .object({ type: z.literal("project_set_hidden"), payload: ProjectSetHiddenPayloadSchema })
    .strict(),
  z
    .object({
      type: z.literal("work_order_delete"),
      payload: z.object({ projectId: z.string().min(1), workOrderId: z.string().min(1) }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("work_order_restore_markdown"),
      payload: z
        .object({
          projectId: z.string().min(1),
          workOrderId: z.string().min(1),
          markdown: z.string(),
        })
        .strict(),
    })
    .strict(),
]);

function alreadyApplied(messageId: string, actionIndex: number): boolean {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM chat_action_ledger WHERE message_id = ? AND action_index = ? LIMIT 1"
    )
    .get(messageId, actionIndex) as { id: string } | undefined;
  return !!row?.id;
}

function parseActionAtIndex(messageId: string, actionIndex: number): { action: ChatAction; runId: string; threadId: string } {
  const message = getChatMessageById(messageId);
  if (!message) throw new Error("message not found");
  if (message.role !== "assistant") throw new Error("only assistant messages can have actions");
  if (!message.run_id) throw new Error("message missing run_id");
  if (!message.actions_json) throw new Error("message has no actions");

  let raw: unknown;
  try {
    raw = JSON.parse(message.actions_json);
  } catch {
    throw new Error("invalid actions_json");
  }
  if (!Array.isArray(raw)) throw new Error("invalid actions_json");
  const item = raw[actionIndex];
  const parsed = ChatActionSchema.safeParse(item);
  if (!parsed.success) throw new Error("invalid action");
  return { action: parsed.data, runId: message.run_id, threadId: message.thread_id };
}

export function applyChatAction(input: unknown) {
  const req = ApplyRequestSchema.parse(input);

  if (alreadyApplied(req.messageId, req.actionIndex)) {
    throw new Error("action already applied");
  }

  const { action, runId, threadId } = parseActionAtIndex(req.messageId, req.actionIndex);

  const applyResult = (() => {
    switch (action.type) {
      case "project_set_star": {
        const payload = ProjectSetStarPayloadSchema.parse(action.payload);
        const project = findProjectById(payload.projectId);
        if (!project) throw new Error("project not found");
        const prev = Boolean(project.starred);
        const ok = setProjectStar(payload.projectId, payload.starred);
        if (!ok) throw new Error("failed to update project");
        const undoPayload: UndoPayload = {
          type: "project_set_star",
          payload: { projectId: payload.projectId, starred: prev },
        };
        return { undoPayload, result: { ok: true } };
      }
      case "project_set_hidden": {
        const payload = ProjectSetHiddenPayloadSchema.parse(action.payload);
        const project = findProjectById(payload.projectId);
        if (!project) throw new Error("project not found");
        const prev = Boolean(project.hidden);
        const ok = setProjectHidden(payload.projectId, payload.hidden);
        if (!ok) throw new Error("failed to update project");
        const undoPayload: UndoPayload = {
          type: "project_set_hidden",
          payload: { projectId: payload.projectId, hidden: prev },
        };
        return { undoPayload, result: { ok: true } };
      }
      case "work_order_create": {
        const payload = WorkOrderCreatePayloadSchema.parse(action.payload);
        const project = findProjectById(payload.projectId);
        if (!project) throw new Error("project not found");
        const created = createWorkOrder(project.path, {
          title: payload.title,
          priority: payload.priority,
          tags: payload.tags,
        });
        const undoPayload: UndoPayload = {
          type: "work_order_delete",
          payload: { projectId: payload.projectId, workOrderId: created.id },
        };
        return { undoPayload, result: { work_order: created } };
      }
      case "work_order_update": {
        const payload = WorkOrderUpdatePayloadSchema.parse(action.payload);
        const project = findProjectById(payload.projectId);
        if (!project) throw new Error("project not found");
        const before = readWorkOrderMarkdown(project.path, payload.workOrderId);
        const updated = patchWorkOrder(project.path, payload.workOrderId, payload.patch);
        const undoPayload: UndoPayload = {
          type: "work_order_restore_markdown",
          payload: {
            projectId: payload.projectId,
            workOrderId: payload.workOrderId,
            markdown: before,
          },
        };
        return { undoPayload, result: { work_order: updated } };
      }
      case "work_order_set_status": {
        const payload = WorkOrderSetStatusPayloadSchema.parse(action.payload);
        const project = findProjectById(payload.projectId);
        if (!project) throw new Error("project not found");
        const before = readWorkOrderMarkdown(project.path, payload.workOrderId);
        const updated = patchWorkOrder(project.path, payload.workOrderId, {
          status: payload.status,
        });
        const undoPayload: UndoPayload = {
          type: "work_order_restore_markdown",
          payload: {
            projectId: payload.projectId,
            workOrderId: payload.workOrderId,
            markdown: before,
          },
        };
        return { undoPayload, result: { work_order: updated } };
      }
      case "repos_rescan": {
        syncAndListRepoSummaries({ forceRescan: true });
        return { undoPayload: null, result: { ok: true } };
      }
      case "work_order_start_run": {
        const payload = WorkOrderStartRunPayloadSchema.parse(action.payload);
        const run = enqueueCodexRun(payload.projectId, payload.workOrderId);
        return { undoPayload: null, result: { run } };
      }
      default: {
        const neverType: never = action.type;
        throw new Error(`unsupported action: ${String(neverType)}`);
      }
    }
  })();

  const ledger = createChatActionLedgerEntry({
    threadId,
    runId,
    messageId: req.messageId,
    actionIndex: req.actionIndex,
    actionType: action.type,
    actionPayload: action.payload,
    undoPayload: applyResult.undoPayload,
    error: null,
  });

  return { ledger, result: applyResult.result };
}

export function undoChatAction(ledgerId: string) {
  const entry = getChatActionLedgerEntry(ledgerId);
  if (!entry) throw new Error("action not found");
  if (entry.undone_at) throw new Error("action already undone");
  if (!entry.undo_payload_json) throw new Error("action is not undoable");

  const undo = UndoPayloadSchema.parse(JSON.parse(entry.undo_payload_json));

  switch (undo.type) {
    case "project_set_star": {
      const payload = ProjectSetStarPayloadSchema.parse(undo.payload);
      const ok = setProjectStar(payload.projectId, payload.starred);
      if (!ok) throw new Error("failed to update project");
      break;
    }
    case "project_set_hidden": {
      const payload = ProjectSetHiddenPayloadSchema.parse(undo.payload);
      const ok = setProjectHidden(payload.projectId, payload.hidden);
      if (!ok) throw new Error("failed to update project");
      break;
    }
    case "work_order_delete": {
      const project = findProjectById(undo.payload.projectId);
      if (!project) throw new Error("project not found");
      deleteWorkOrder(project.path, undo.payload.workOrderId);
      break;
    }
    case "work_order_restore_markdown": {
      const project = findProjectById(undo.payload.projectId);
      if (!project) throw new Error("project not found");
      overwriteWorkOrderMarkdown(project.path, undo.payload.workOrderId, undo.payload.markdown);
      break;
    }
  }

  const ok = markChatActionUndone({ ledgerId, error: null });
  if (!ok) throw new Error("failed to mark action undone");
  return { ok: true };
}

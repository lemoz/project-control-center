import { z } from "zod";

export const CHAT_ACTION_TYPES = [
  "project_set_star",
  "project_set_hidden",
  "work_order_create",
  "work_order_update",
  "work_order_set_status",
  "repos_rescan",
  "work_order_start_run",
] as const;

export type ChatActionType = (typeof CHAT_ACTION_TYPES)[number];

export const WorkOrderStatusSchema = z.enum([
  "backlog",
  "ready",
  "building",
  "ai_review",
  "you_review",
  "done",
  "blocked",
  "parked",
]);

export const ProjectSetStarPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    starred: z.boolean(),
  })
  .strict();

export const ProjectSetHiddenPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    hidden: z.boolean(),
  })
  .strict();

export const WorkOrderCreatePayloadSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export const WorkOrderPatchSchema = z
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
    status: WorkOrderStatusSchema.optional(),
  })
  .strict()
  .partial();

export const WorkOrderUpdatePayloadSchema = z
  .object({
    projectId: z.string().min(1),
    workOrderId: z.string().min(1),
    patch: WorkOrderPatchSchema,
  })
  .strict();

export const WorkOrderSetStatusPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    workOrderId: z.string().min(1),
    status: WorkOrderStatusSchema,
  })
  .strict();

export const WorkOrderStartRunPayloadSchema = z
  .object({
    projectId: z.string().min(1),
    workOrderId: z.string().min(1),
  })
  .strict();

export const ChatActionPayloadSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    workOrderId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    starred: z.boolean().optional(),
    hidden: z.boolean().optional(),
    status: WorkOrderStatusSchema.optional(),
    patch: WorkOrderPatchSchema.optional(),
  })
  .strict();

export const ChatActionSchema = z
  .object({
    type: z.enum(CHAT_ACTION_TYPES),
    title: z.string().min(1),
    payload: ChatActionPayloadSchema,
  })
  .strict();

export type ChatAction = z.infer<typeof ChatActionSchema>;

export const ChatActionWireSchema = z
  .object({
    type: z.enum(CHAT_ACTION_TYPES),
    title: z.string().min(1),
    payload_json: z.string(),
  })
  .strict();

export type ChatActionWire = z.infer<typeof ChatActionWireSchema>;

export const ChatResponseSchema = z
  .object({
    reply: z.string(),
    actions: z.array(ChatActionSchema),
  })
  .strict();

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ChatResponseWireSchema = z
  .object({
    reply: z.string(),
    actions: z.array(ChatActionWireSchema),
  })
  .strict();

export type ChatResponseWire = z.infer<typeof ChatResponseWireSchema>;

export const ChatSummaryResponseSchema = z
  .object({
    summary: z.string(),
  })
  .strict();

export type ChatSummaryResponse = z.infer<typeof ChatSummaryResponseSchema>;

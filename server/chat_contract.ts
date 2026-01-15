import { z } from "zod";

export const CHAT_CONTEXT_DEPTHS = [
  "minimal",
  "messages",
  "messages_tools",
  "messages_tools_outputs",
  "blended",
] as const;

export type ChatContextDepth = (typeof CHAT_CONTEXT_DEPTHS)[number];

export const ChatContextDepthSchema = z.enum(CHAT_CONTEXT_DEPTHS);

export const CHAT_FILESYSTEM_ACCESS = ["none", "read-only", "read-write"] as const;
export type ChatFilesystemAccess = (typeof CHAT_FILESYSTEM_ACCESS)[number];
export const ChatFilesystemAccessSchema = z.enum(CHAT_FILESYSTEM_ACCESS);

export const CHAT_CLI_ACCESS = ["off", "read-only", "read-write"] as const;
export type ChatCliAccess = (typeof CHAT_CLI_ACCESS)[number];
export const ChatCliAccessSchema = z.enum(CHAT_CLI_ACCESS);

export const CHAT_NETWORK_ACCESS = ["none", "localhost", "allowlist", "trusted"] as const;
export type ChatNetworkAccess = (typeof CHAT_NETWORK_ACCESS)[number];
export const ChatNetworkAccessSchema = z.enum(CHAT_NETWORK_ACCESS);

export const ChatAccessSchema = z
  .object({
    filesystem: ChatFilesystemAccessSchema,
    cli: ChatCliAccessSchema,
    network: ChatNetworkAccessSchema,
    network_allowlist: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type ChatAccess = z.infer<typeof ChatAccessSchema>;

export const ChatContextSelectionSchema = z
  .object({
    depth: ChatContextDepthSchema,
  })
  .strict();

export type ChatContextSelection = z.infer<typeof ChatContextSelectionSchema>;

export const ChatSuggestionSchema = z
  .object({
    context_depth: ChatContextDepthSchema.optional(),
    access: ChatAccessSchema.partial().optional(),
    reason: z.string().optional(),
  })
  .strict();

export type ChatSuggestion = z.infer<typeof ChatSuggestionSchema>;

export const ChatConfirmationsSchema = z
  .object({
    write: z.boolean().optional(),
    network_allowlist: z.boolean().optional(),
  })
  .strict();

export type ChatConfirmations = z.infer<typeof ChatConfirmationsSchema>;

export const ChatMessageRequestSchema = z
  .object({
    content: z.string().min(1),
    context: ChatContextSelectionSchema.optional(),
    access: ChatAccessSchema.optional(),
    suggestion: ChatSuggestionSchema.optional(),
    confirmations: ChatConfirmationsSchema.optional(),
  })
  .strict();

export type ChatMessageRequest = z.infer<typeof ChatMessageRequestSchema>;

export const ChatSuggestRequestSchema = z
  .object({
    content: z.string().min(1),
    context: ChatContextSelectionSchema.optional(),
    access: ChatAccessSchema.optional(),
  })
  .strict();

export type ChatSuggestRequest = z.infer<typeof ChatSuggestRequestSchema>;

export const CHAT_ACTION_TYPES = [
  "project_set_star",
  "project_set_hidden",
  "project_set_success",
  "work_order_create",
  "work_order_update",
  "work_order_set_status",
  "repos_rescan",
  "work_order_start_run",
  "worktree_merge",
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
    depends_on: z.array(z.string()).optional(),
    era: z.string().optional(),
    base_branch: z.string().optional(),
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
    base_branch: z.string().nullable().optional(),
    estimate_hours: z.number().nullable().optional(),
    status: WorkOrderStatusSchema.optional(),
    depends_on: z.array(z.string()).optional(),
    era: z.string().nullable().optional(),
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
    source_branch: z.string().optional(),
  })
  .strict();

export const SuccessMetricSchema = z
  .object({
    name: z.string().min(1),
    target: z.union([z.number(), z.string()]),
    current: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .strict();

export const ChatActionPayloadSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    workOrderId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    base_branch: z.string().optional(),
    source_branch: z.string().optional(),
    starred: z.boolean().optional(),
    hidden: z.boolean().optional(),
    success_criteria: z.string().min(1).optional(),
    success_metrics: z.array(SuccessMetricSchema).optional(),
    status: WorkOrderStatusSchema.optional(),
    patch: WorkOrderPatchSchema.optional(),
    depends_on: z.array(z.string()).optional(),
    era: z.string().optional(),
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
    needs_user_input: z.boolean().optional(),
  })
  .strict();

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ChatResponseWireSchema = z
  .object({
    reply: z.string(),
    actions: z.array(ChatActionWireSchema),
    needs_user_input: z.boolean().optional(),
  })
  .strict();

export const CHAT_SCOPES = ["global", "project", "work_order"] as const;
export type ChatScope = (typeof CHAT_SCOPES)[number];
export const ChatScopeSchema = z.enum(CHAT_SCOPES);

export const ChatThreadDefaultsSchema = z
  .object({
    context: ChatContextSelectionSchema.optional(),
    access: ChatAccessSchema.optional(),
  })
  .strict();

export type ChatThreadDefaults = z.infer<typeof ChatThreadDefaultsSchema>;

export const ChatThreadCreateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    scope: ChatScopeSchema,
    projectId: z.string().min(1).optional(),
    workOrderId: z.string().min(1).optional(),
    defaults: ChatThreadDefaultsSchema.optional(),
  })
  .strict();

export type ChatThreadCreateRequest = z.infer<typeof ChatThreadCreateRequestSchema>;

export const ChatThreadUpdateRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    scope: ChatScopeSchema.optional(),
    projectId: z.string().min(1).nullable().optional(),
    workOrderId: z.string().min(1).nullable().optional(),
    defaults: ChatThreadDefaultsSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export type ChatThreadUpdateRequest = z.infer<typeof ChatThreadUpdateRequestSchema>;

export type ChatResponseWire = z.infer<typeof ChatResponseWireSchema>;

export const ChatSummaryResponseSchema = z
  .object({
    summary: z.string(),
  })
  .strict();

export type ChatSummaryResponse = z.infer<typeof ChatSummaryResponseSchema>;

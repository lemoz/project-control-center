export type ChatScope = "global" | "project" | "work_order";

export type AttentionReasonCode =
  | "pending_action"
  | "pending_approval"
  | "needs_user_input"
  | "run_failed"
  | "undo_failed";

export type AttentionReason = {
  code: AttentionReasonCode;
  created_at: string;
  count: number;
  action_titles?: string[];
};

export type AttentionSummary = {
  needs_you: boolean;
  reason_codes: AttentionReasonCode[];
  reasons: AttentionReason[];
  last_event_at: string | null;
};

export type AttentionItem = {
  thread_id: string;
  scope: ChatScope;
  project_id: string | null;
  work_order_id: string | null;
  project_name: string | null;
  work_order_title: string | null;
  attention: AttentionSummary;
};

export type AttentionResponse = {
  items: AttentionItem[];
  limited?: boolean;
  scan_limit?: number | null;
  error?: string;
};

export function attentionReasonLabel(code: AttentionReasonCode): string {
  switch (code) {
    case "pending_action":
      return "Pending actions";
    case "pending_approval":
      return "Pending approval";
    case "needs_user_input":
      return "Needs your input";
    case "run_failed":
      return "Run failed";
    case "undo_failed":
      return "Undo failed";
    default:
      return "Attention";
  }
}

export function scopeLabel(scope: ChatScope): string {
  if (scope === "project") return "Project";
  if (scope === "work_order") return "Work order";
  return "Global";
}

export function buildChatHref(
  item: AttentionItem,
  basePath = "/",
  queryString = ""
): string | null {
  if (!item.thread_id) return null;
  const params = new URLSearchParams(queryString);
  params.set("chat", "1");
  params.set("thread", item.thread_id);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function buildLocationLabel(item: AttentionItem): string {
  if (item.scope === "global") return "Global thread";
  const projectLabel = item.project_name || item.project_id || "Unknown project";
  if (item.scope === "project") return projectLabel;
  const workOrderLabel =
    item.work_order_title || item.work_order_id || "Unknown work order";
  return `${projectLabel} / ${workOrderLabel}`;
}

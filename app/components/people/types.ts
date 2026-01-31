export const IDENTIFIER_TYPES = ["phone", "email", "imessage", "other"] as const;
export type PersonIdentifierType = (typeof IDENTIFIER_TYPES)[number];

export const PROJECT_RELATIONSHIPS = [
  "stakeholder",
  "collaborator",
  "client",
  "vendor",
  "other",
] as const;
export type PersonProjectRelationship = (typeof PROJECT_RELATIONSHIPS)[number];

export const CONVERSATION_CHANNELS = [
  "imessage",
  "email",
  "meeting",
  "call",
  "note",
] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CONVERSATION_DIRECTIONS = ["inbound", "outbound", "bidirectional"] as const;
export type ConversationDirection = (typeof CONVERSATION_DIRECTIONS)[number];

export type Person = {
  id: string;
  name: string;
  nickname: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  tags: string[];
  starred: boolean;
  created_at: string;
  updated_at: string;
};

export type PersonIdentifier = {
  id: string;
  person_id: string;
  type: PersonIdentifierType;
  value: string;
  normalized_value: string;
  label: string | null;
  created_at: string;
};

export type PersonProject = {
  id: string;
  person_id: string;
  project_id: string;
  relationship: PersonProjectRelationship;
  notes: string | null;
  created_at: string;
};

export type PersonDetails = Person & {
  identifiers: PersonIdentifier[];
  projects: PersonProject[];
};

export type ConversationEvent = {
  id: string;
  person_id: string;
  channel: ConversationChannel;
  direction: ConversationDirection;
  summary: string | null;
  content: string | null;
  external_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  synced_at: string;
};

export type PeopleSyncStatus = {
  person_id: string;
  channel: ConversationChannel;
  last_synced_at: string;
  last_external_id: string | null;
};

export type ConversationSummary = {
  person_id: string;
  recent_activity_count: number;
  recent_window_days: number;
  last_interaction: ConversationEvent | null;
  last_interaction_by_channel: Record<ConversationChannel, ConversationEvent | null>;
  sync_status: PeopleSyncStatus[];
};

export type ImportReport = {
  source: "mac-contacts" | "legacy-imessage-crm";
  dry_run: boolean;
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ name: string | null; reason: string }>;
  total_processed: number;
};

export type RepoSummary = {
  id: string;
  name: string;
  description: string | null;
  path: string;
  type: "prototype" | "long_term";
  stage: string;
  status: "active" | "blocked" | "parked";
  lifecycle_status?: "active" | "stable" | "maintenance" | "archived";
  priority: number;
  starred: boolean;
  hidden: boolean;
  tags: string[];
};

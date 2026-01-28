export type Track = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  goal: string | null;
  status: "active" | "paused" | "completed";
  parentTrackId: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  workOrderCount?: number;
  doneCount?: number;
  readyCount?: number;
};

export type TrackOrganizationMode = "initial" | "incremental" | "reorg";

export type TrackOrganizationTrack = {
  id: string;
  name: string;
  goal: string | null;
  status: "active" | "paused" | "completed";
  parent_track_id: string | null;
};

export type TrackOrganizationAssignment = {
  wo_id: string;
  track_ids: string[];
};

export type TrackOrganizationSuggestion = {
  tracks: TrackOrganizationTrack[];
  assignments: TrackOrganizationAssignment[];
  recommendations: string[];
};

export type TrackOrganizationScope = {
  total_work_orders: number;
  unassigned_work_orders: number;
  assigned_work_orders: number;
};

export type TrackOrganizationResult = {
  mode: TrackOrganizationMode;
  scope: TrackOrganizationScope;
  suggestions: TrackOrganizationSuggestion;
  warnings: string[];
};

export type TrackOrganizationApplyResult = {
  created_tracks: Track[];
  updated_tracks: Track[];
  assignments_applied: number;
  assignments_cleared: number;
  warnings: string[];
};

export type CreateTrackInput = {
  name: string;
  description?: string | null;
  goal?: string | null;
  status?: "active" | "paused" | "completed";
  parentTrackId?: string | null;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
};

export type UpdateTrackInput = {
  name?: string;
  description?: string | null;
  goal?: string | null;
  status?: "active" | "paused" | "completed";
  parentTrackId?: string | null;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
};

type TracksResponse = { tracks: Track[]; error?: string };
type TrackResponse = { track: Track; error?: string };
type ErrorResponse = { error?: string };
type TrackOrganizationResponse = TrackOrganizationResult & { error?: string };
type TrackOrganizationApplyResponse = TrackOrganizationApplyResult & { error?: string };

export async function listTracks(projectId: string): Promise<Track[]> {
  const res = await fetch(
    `/api/repos/${encodeURIComponent(projectId)}/tracks`,
    { cache: "no-store" }
  ).catch(() => null);

  if (!res) {
    throw new Error("Control Center server unreachable");
  }

  const json = (await res.json().catch(() => null)) as TracksResponse | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to load tracks");
  }
  return json?.tracks ?? [];
}

export async function createTrack(
  projectId: string,
  data: CreateTrackInput
): Promise<Track> {
  const res = await fetch(`/api/repos/${encodeURIComponent(projectId)}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => null);

  if (!res) {
    throw new Error("Control Center server unreachable");
  }

  const json = (await res.json().catch(() => null)) as TrackResponse | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to create track");
  }
  if (!json?.track) {
    throw new Error("Track payload missing");
  }
  return json.track;
}

export async function updateTrack(
  projectId: string,
  trackId: string,
  data: UpdateTrackInput
): Promise<Track> {
  const res = await fetch(
    `/api/repos/${encodeURIComponent(projectId)}/tracks/${encodeURIComponent(trackId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  ).catch(() => null);

  if (!res) {
    throw new Error("Control Center server unreachable");
  }

  const json = (await res.json().catch(() => null)) as TrackResponse | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to update track");
  }
  if (!json?.track) {
    throw new Error("Track payload missing");
  }
  return json.track;
}

export async function deleteTrack(
  projectId: string,
  trackId: string
): Promise<void> {
  const res = await fetch(
    `/api/repos/${encodeURIComponent(projectId)}/tracks/${encodeURIComponent(trackId)}`,
    { method: "DELETE" }
  ).catch(() => null);

  if (!res) {
    throw new Error("Control Center server unreachable");
  }

  const json = (await res.json().catch(() => null)) as ErrorResponse | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to delete track");
  }
}

export async function reorderTracks(
  projectId: string,
  trackIds: string[]
): Promise<void> {
  await Promise.all(
    trackIds.map((trackId, index) =>
      updateTrack(projectId, trackId, { sortOrder: index })
    )
  );
}

export async function generateTrackOrganizationSuggestions(
  projectId: string,
  mode: TrackOrganizationMode
): Promise<TrackOrganizationResult> {
  const res = await fetch(
    `/api/repos/${encodeURIComponent(projectId)}/tracks/organize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    }
  ).catch(() => null);

  if (!res) {
    throw new Error("Control Center server unreachable");
  }

  const json = (await res.json().catch(() => null)) as TrackOrganizationResponse | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to generate track suggestions");
  }
  if (!json) {
    throw new Error("Track suggestions payload missing");
  }
  return json;
}

export async function applyTrackOrganizationSuggestions(
  projectId: string,
  mode: TrackOrganizationMode,
  suggestions: TrackOrganizationSuggestion
): Promise<TrackOrganizationApplyResult> {
  const res = await fetch(
    `/api/repos/${encodeURIComponent(projectId)}/tracks/organize/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, suggestions }),
    }
  ).catch(() => null);

  if (!res) {
    throw new Error("Control Center server unreachable");
  }

  const json = (await res.json().catch(() => null)) as TrackOrganizationApplyResponse | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to apply track suggestions");
  }
  if (!json) {
    throw new Error("Track apply payload missing");
  }
  return json;
}

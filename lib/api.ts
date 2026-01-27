export type Track = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  goal: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  workOrderCount?: number;
  doneCount?: number;
  readyCount?: number;
};

export type CreateTrackInput = {
  name: string;
  description?: string | null;
  goal?: string | null;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
};

export type UpdateTrackInput = {
  name?: string;
  description?: string | null;
  goal?: string | null;
  color?: string | null;
  icon?: string | null;
  sortOrder?: number;
};

type TracksResponse = { tracks: Track[]; error?: string };
type TrackResponse = { track: Track; error?: string };
type ErrorResponse = { error?: string };

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

import type { Track } from "../db.js";
import type { WorkOrder } from "../work_orders.js";

export type TrackOrganizationMode = "initial" | "incremental" | "reorg";

type TrackOrganizationPromptInput = {
  mode: TrackOrganizationMode;
  tracks: Track[];
  workOrders: WorkOrder[];
};

function formatTrackList(tracks: Track[]): string {
  if (!tracks.length) return "None.";
  return tracks
    .map((track) => {
      const goal = track.goal ? track.goal : "none";
      const parent = track.parentTrackId ? track.parentTrackId : "none";
      return `- ${track.id}: ${track.name} | status: ${track.status} | goal: ${goal} | parent: ${parent}`;
    })
    .join("\n");
}

function formatWorkOrders(workOrders: WorkOrder[]): string {
  if (!workOrders.length) return "None.";
  return workOrders
    .map((wo) => {
      const tags = wo.tags.length ? wo.tags.join(", ") : "none";
      const deps = wo.depends_on.length ? wo.depends_on.join(", ") : "none";
      const tracks = wo.tracks.length
        ? wo.tracks.map((track) => `${track.name} (${track.id})`).join("; ")
        : "none";
      return `- ${wo.id}: ${wo.title} | status: ${wo.status} | priority: ${wo.priority} | tags: ${tags} | deps: ${deps} | tracks: ${tracks}`;
    })
    .join("\n");
}

function formatModeGuidance(mode: TrackOrganizationMode): string {
  if (mode === "incremental") {
    return `Mode: incremental.
- Only assign the work orders listed below (these are unassigned).
- Prefer existing tracks when possible.
- Create new tracks only if there is no good fit.
- Do not reassign existing work orders already attached to tracks.`;
  }
  if (mode === "reorg") {
    return `Mode: reorg.
- Review all work orders and propose a full track organization.
- Suggest merges/splits via the recommendations list.
- Assign every work order to one or more tracks.`;
  }
  return `Mode: initial.
- No tracks exist yet. Propose a full track structure and assignments.`;
}

export function buildTrackOrganizationPrompt(input: TrackOrganizationPromptInput): string {
  return `Organize these work orders into tracks.

A track is a coherent stream of related work. Constraints:
- Maximum 8 top-level tracks (use sub-tracks for finer granularity)
- Work orders can belong to multiple tracks
- Use your judgment on what groupings are natural

${formatModeGuidance(input.mode)}

Existing tracks (use their IDs when referencing them):
${formatTrackList(input.tracks)}

Work orders to consider:
${formatWorkOrders(input.workOrders)}

Output JSON only (no markdown, no commentary).
Use track IDs as follows:
- For existing tracks: use the existing track ID.
- For new tracks: use an ID that starts with "new:" (example: "new:runner-infra").

Schema:
{
  "tracks": [
    {
      "id": "existing-id-or-new:slug",
      "name": "Track name",
      "goal": "Track goal or null",
      "status": "active|paused|completed",
      "parent_track_id": "existing-id-or-new:slug-or-null"
    }
  ],
  "assignments": [
    {
      "wo_id": "WO-2026-108",
      "track_ids": ["existing-or-new-track-id"]
    }
  ],
  "recommendations": ["Optional notes about merges/splits/new tracks"]
}`;
}

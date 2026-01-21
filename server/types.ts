export type TrackProgress = {
  done: number;
  ready: number;
  building: number;
  backlog: number;
  total: number;
};

export type TrackSummary = {
  id: string;
  name: string;
  goal: string | null;
  color: string | null;
  progress: TrackProgress;
  recentActivity: string | null;
};

export type TrackContext = {
  active: TrackSummary[];
  stalled: TrackSummary[];
};

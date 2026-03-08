import type { Novel, NovelPayload, Timeline, TimelineEvent } from '../../shared/types';

export interface LocalSnapshot {
  novel: Novel;
  timelines: Timeline[];
  events: TimelineEvent[];
}

const MAX_UNDO = 50;

function cloneSnapshot(snapshot: LocalSnapshot): LocalSnapshot {
  return {
    novel: { ...snapshot.novel },
    timelines: snapshot.timelines.map((timeline) => ({ ...timeline })),
    events: snapshot.events.map((event) => ({ ...event }))
  };
}

export function snapshotFromPayload(payload: NovelPayload): LocalSnapshot {
  return {
    novel: { ...payload.novel },
    timelines: payload.timelines.map((timeline) => ({ ...timeline })),
    events: payload.events.map((event) => ({ ...event }))
  };
}

export function serializeSnapshot(snapshot: LocalSnapshot): string {
  return JSON.stringify(snapshot);
}

export function appendHistory(
  history: LocalSnapshot[],
  undoIndex: number,
  snapshot: LocalSnapshot
): LocalSnapshot[] {
  const base = history.slice(0, undoIndex + 1);
  const next = [...base, cloneSnapshot(snapshot)];
  return next.slice(-MAX_UNDO);
}

import type { Chapter, Novel, NovelPayload, Timeline, TimelineEvent } from '../../shared/types';

export interface LocalSnapshot {
  novel: Novel;
  chapters: Chapter[];
  timelines: Timeline[];
  events: TimelineEvent[];
  currentChapterId: string | null;
}

const MAX_UNDO = 50;

function cloneSnapshot(snapshot: LocalSnapshot): LocalSnapshot {
  return {
    novel: { ...snapshot.novel },
    chapters: snapshot.chapters.map((chapter) => ({ ...chapter })),
    timelines: snapshot.timelines.map((timeline) => ({ ...timeline })),
    events: snapshot.events.map((event) => ({ ...event })),
    currentChapterId: snapshot.currentChapterId
  };
}

export function snapshotFromPayload(payload: NovelPayload, currentChapterId: string | null): LocalSnapshot {
  return {
    novel: { ...payload.novel },
    chapters: payload.chapters.map((chapter) => ({ ...chapter })),
    timelines: payload.timelines.map((timeline) => ({ ...timeline })),
    events: payload.events.map((event) => ({ ...event })),
    currentChapterId
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

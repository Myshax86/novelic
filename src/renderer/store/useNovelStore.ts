import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  Chapter,
  CreateEventInput,
  Novel,
  NovelPayload,
  Timeline,
  TimelineEvent,
  UpdateEventInput
} from '../../shared/types';
import {
  appendHistory,
  type LocalSnapshot,
  serializeSnapshot,
  snapshotFromPayload
} from './history';
import { novelApi } from './novelApi';
import {
  BASE_MIN_GAP,
  alignConnectedPoints,
  anchoredBubblePosition,
  bubblePosition,
  desiredBubblePosition,
  enforceComponentPointClearance,
  eventScopeBounds,
  pointClearance,
  resolveTimelineBubbleCollisions,
  selectAnchorPoint,
  slideTimelinePointsFromBubbles,
  type BubbleSide,
  type BubbleZone,
  type TimePoint,
  type TimePointConnection,
  type TimelineBubbleEvent,
  type TimelineEventDependency
} from './timelineLayout';

interface NovelStore {
  novels: Novel[];
  currentNovel: Novel | null;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  lastError: string | null;
  timelines: Timeline[];
  events: TimelineEvent[];
  selectedCursor: string | null;
  overlappingEvents: TimelineEvent[];
  undo_history: LocalSnapshot[];
  undo_index: number;
  searchQuery: string;
  timePointsByNovel: Record<string, TimePoint[]>;
  timePointConnectionsByNovel: Record<string, TimePointConnection[]>;
  bubbleEventsByNovel: Record<string, TimelineBubbleEvent[]>;
  eventDependenciesByNovel: Record<string, TimelineEventDependency[]>;
  timelineColumnWidthsByNovel: Record<string, Record<string, number>>;
  timelineVerticalMaxByNovel: Record<string, number>;
  layout_undo_history: LayoutSnapshot[];
  layout_undo_index: number;
  clearError: () => void;
  initialize: () => Promise<void>;
  createNovel: (name: string) => Promise<void>;
  selectNovel: (novelId: string) => Promise<void>;
  selectChapter: (chapterId: string) => Promise<void>;
  createChapter: (name: string) => Promise<void>;
  renameChapter: (chapterId: string, name: string) => Promise<void>;
  deleteChapter: (chapterId: string) => Promise<void>;
  createTimeline: (name: string, color: string) => Promise<void>;
  updateTimelineColor: (timelineId: string, color: string) => Promise<void>;
  updateTimelineName: (timelineId: string, name: string) => Promise<void>;
  createEvent: (input: Omit<CreateEventInput, 'novel_id'>) => Promise<void>;
  updateEvent: (input: UpdateEventInput) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  deleteTimeline: (timelineId: string) => Promise<void>;
  setCursor: (cursorIso: string | null) => Promise<void>;
  setSearchQuery: (query: string) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  exportNovelJson: () => Promise<void>;
  exportTimelineCsv: (timelineId: string) => Promise<void>;
  importNovelJson: () => Promise<void>;
  addTimePoint: (label: string, position: number, timelineId: string) => void;
  updateTimePoint: (id: string, label: string) => void;
  updateTimePointPosition: (id: string, position: number) => void;
  deleteTimePoint: (id: string) => void;
  addTimePointConnection: (fromPointId: string, toPointId: string) => void;
  addBubbleEvent: (title: string, timelineId: string, preferredPosition: number) => boolean;
  updateBubbleEventTitle: (eventId: string, title: string) => void;
  moveBubbleEvent: (eventId: string, nextPosition: number) => boolean;
  settleBubbleEventPosition: (eventId: string) => boolean;
  deleteBubbleEvent: (eventId: string) => void;
  addEventDependency: (fromEventId: string, toEventId: string) => boolean;
  deleteEventDependency: (dependencyId: string) => void;
  setBubbleEventSide: (eventId: string, side: BubbleSide) => void;
  repairCollapsedBubbleEvents: () => boolean;
  setTimelineColumnWidth: (timelineId: string, width: number) => void;
  ensureTimelineVerticalExtent: (requestedPosition: number) => number;
  captureLayoutSnapshot: () => void;
  reorderTimelines: (
    sourceTimelineId: string,
    targetTimelineId: string,
    dropPosition: 'before' | 'after'
  ) => Promise<void>;
}

interface LayoutSnapshot {
  scopeKey: string;
  points: TimePoint[];
  connections: TimePointConnection[];
  bubbles: TimelineBubbleEvent[];
  dependencies: TimelineEventDependency[];
  columnWidths: Record<string, number>;
  verticalMax: number;
}

const CURSOR_QUERY_DEBOUNCE_MS = 80;
const DEFAULT_TIMELINE_VERTICAL_MAX = 1;
const VERTICAL_EDGE_GROWTH_CHUNK = 0.25;
const VERTICAL_HEADROOM_VIEWPORTS = 1;
const VERTICAL_MIN_FORWARD_BUFFER = 0.2;
const VERTICAL_MAX_HARD_LIMIT = 24;
const MAX_LAYOUT_UNDO = 80;

let cursorQueryTimer: number | null = null;
let cursorQueryToken = 0;

function resetCursorQueryState(): void {
  cursorQueryToken += 1;
  if (cursorQueryTimer) {
    window.clearTimeout(cursorQueryTimer);
    cursorQueryTimer = null;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Unexpected operation failure.';
}

function clampPosition(value: number, maxPosition: number): number {
  return Math.max(0, Math.min(maxPosition, value));
}

function chapterScopeKey(novelId: string, chapterId: string | null): string {
  return `${novelId}::${chapterId ?? '__no_chapter__'}`;
}

function currentLayoutScopeKey(state: Pick<NovelStore, 'currentNovel' | 'currentChapter'>): string | null {
  if (!state.currentNovel) return null;
  return chapterScopeKey(state.currentNovel.id, state.currentChapter?.id ?? null);
}

function chapterScopedState(payload: NovelPayload, preferredChapterId: string | null) {
  if (payload.chapters.length === 0) {
    return {
      chapter: null,
      timelines: [] as Timeline[],
      events: [] as TimelineEvent[]
    };
  }

  const chapter = payload.chapters.find((item) => item.id === preferredChapterId) ?? payload.chapters[0];
  const timelines = payload.timelines.filter((timeline) => timeline.chapter_id === chapter.id);
  const timelineIds = new Set(timelines.map((timeline) => timeline.id));
  const events = payload.events.filter((event) => timelineIds.has(event.timeline_id));
  return { chapter, timelines, events };
}

function migrateLegacyLayoutScope(state: NovelStore, novelId: string, chapterId: string | null) {
  if (!chapterId) {
    return {
      timePointsByNovel: state.timePointsByNovel,
      timePointConnectionsByNovel: state.timePointConnectionsByNovel,
      bubbleEventsByNovel: state.bubbleEventsByNovel,
      eventDependenciesByNovel: state.eventDependenciesByNovel,
      timelineColumnWidthsByNovel: state.timelineColumnWidthsByNovel,
      timelineVerticalMaxByNovel: state.timelineVerticalMaxByNovel
    };
  }

  const legacyKey = novelId;
  const scopedKey = chapterScopeKey(novelId, chapterId);

  const migrateRecord = <T,>(record: Record<string, T>): Record<string, T> => {
    if (record[scopedKey] || !record[legacyKey]) {
      return record;
    }
    const { [legacyKey]: legacyValue, ...rest } = record;
    return {
      ...rest,
      [scopedKey]: legacyValue
    };
  };

  return {
    timePointsByNovel: migrateRecord(state.timePointsByNovel),
    timePointConnectionsByNovel: migrateRecord(state.timePointConnectionsByNovel),
    bubbleEventsByNovel: migrateRecord(state.bubbleEventsByNovel),
    eventDependenciesByNovel: migrateRecord(state.eventDependenciesByNovel),
    timelineColumnWidthsByNovel: migrateRecord(state.timelineColumnWidthsByNovel),
    timelineVerticalMaxByNovel: migrateRecord(state.timelineVerticalMaxByNovel)
  };
}

function timelineContentMaxPosition(points: TimePoint[], bubbles: TimelineBubbleEvent[]): number {
  const pointsById = new Map(points.map((point) => [point.id, point]));
  let maxPosition = DEFAULT_TIMELINE_VERTICAL_MAX;

  points.forEach((point) => {
    if (point.position > maxPosition) {
      maxPosition = point.position;
    }
  });

  bubbles.forEach((event) => {
    const pos = bubblePosition(event, pointsById);
    if (pos > maxPosition) {
      maxPosition = pos;
    }
  });

  return maxPosition;
}

function cloneLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
  return {
    scopeKey: snapshot.scopeKey,
    points: snapshot.points.map((point) => ({ ...point })),
    connections: snapshot.connections.map((connection) => ({ ...connection })),
    bubbles: snapshot.bubbles.map((bubble) => ({ ...bubble })),
    dependencies: snapshot.dependencies.map((dep) => ({ ...dep })),
    columnWidths: { ...snapshot.columnWidths },
    verticalMax: snapshot.verticalMax
  };
}

function buildLayoutSnapshot(state: NovelStore): LayoutSnapshot | null {
  const scopeKey = currentLayoutScopeKey(state);
  if (!scopeKey) return null;
  return {
    scopeKey,
    points: (state.timePointsByNovel[scopeKey] ?? []).map((point) => ({ ...point })),
    connections: (state.timePointConnectionsByNovel[scopeKey] ?? []).map((connection) => ({ ...connection })),
    bubbles: (state.bubbleEventsByNovel[scopeKey] ?? []).map((bubble) => ({ ...bubble })),
    dependencies: (state.eventDependenciesByNovel[scopeKey] ?? []).map((dep) => ({ ...dep })),
    columnWidths: { ...(state.timelineColumnWidthsByNovel[scopeKey] ?? {}) },
    verticalMax: state.timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX
  };
}

function sameLayoutSnapshot(a: LayoutSnapshot, b: LayoutSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function connectedDependencyEventIds(
  eventId: string,
  deps: TimelineEventDependency[],
  events: TimelineBubbleEvent[],
  edgeFilter?: (from: TimelineBubbleEvent, to: TimelineBubbleEvent, dep: TimelineEventDependency) => boolean
): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  const eventById = new Map(events.map((event) => [event.id, event]));

  const link = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set<string>());
    adjacency.get(a)?.add(b);
  };

  deps.forEach((dep) => {
    const from = eventById.get(dep.from_event_id);
    const to = eventById.get(dep.to_event_id);
    if (!from || !to) return;
    if (edgeFilter && !edgeFilter(from, to, dep)) return;
    link(dep.from_event_id, dep.to_event_id);
    link(dep.to_event_id, dep.from_event_id);
  });

  const visited = new Set<string>([eventId]);
  const queue = [eventId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const neighbors = adjacency.get(current);
    if (!neighbors) continue;
    neighbors.forEach((neighbor) => {
      if (visited.has(neighbor)) return;
      visited.add(neighbor);
      queue.push(neighbor);
    });
  }

  return visited;
}

function connectedHorizontalDependencyEventIds(
  eventId: string,
  deps: TimelineEventDependency[],
  events: TimelineBubbleEvent[]
): Set<string> {
  return connectedDependencyEventIds(
    eventId,
    deps,
    events,
    (from, to) => from.timeline_id !== to.timeline_id
  );
}

function spreadCoincidentEvents(
  events: TimelineBubbleEvent[],
  points: TimePoint[],
  maxPosition: number,
  candidateIds?: Set<string>
): TimelineBubbleEvent[] {
  if (events.length < 2) return events;

  const pointsById = new Map(points.map((point) => [point.id, point]));
  const byTimeline = new Map<string, TimelineBubbleEvent[]>();

  events.forEach((event) => {
    if (candidateIds && !candidateIds.has(event.id)) return;
    const bucket = byTimeline.get(event.timeline_id) ?? [];
    bucket.push(event);
    byTimeline.set(event.timeline_id, bucket);
  });

  const nextById = new Map<string, TimelineBubbleEvent>();

  byTimeline.forEach((timelineEvents) => {
    if (timelineEvents.length < 2) return;

    const sorted = [...timelineEvents].sort((a, b) => {
      const aPos = bubblePosition(a, pointsById);
      const bPos = bubblePosition(b, pointsById);
      if (Math.abs(aPos - bPos) > 0.000001) return aPos - bPos;
      return a.id.localeCompare(b.id);
    });

    let index = 0;
    while (index < sorted.length) {
      const run = [sorted[index]];
      const basePos = bubblePosition(sorted[index], pointsById);
      let cursor = index + 1;
      while (cursor < sorted.length) {
        const nextPos = bubblePosition(sorted[cursor], pointsById);
        if (Math.abs(nextPos - basePos) > 0.000001) break;
        run.push(sorted[cursor]);
        cursor += 1;
      }

      if (run.length > 1) {
        const start = basePos - ((run.length - 1) * BASE_MIN_GAP) / 2;
        run.forEach((event, offsetIndex) => {
          const desired = clampPosition(start + offsetIndex * BASE_MIN_GAP, maxPosition);
          nextById.set(event.id, anchoredBubblePosition(event, desired, pointsById, points, maxPosition));
        });
      }

      index = cursor;
    }
  });

  if (nextById.size === 0) return events;
  return events.map((event) => nextById.get(event.id) ?? event);
}

async function pushSnapshotToDb(snapshot: LocalSnapshot): Promise<void> {
  await novelApi.createSnapshot(snapshot.novel.id, serializeSnapshot(snapshot));
}

export const useNovelStore = create<NovelStore>()(
  persist(
    (set, get) => ({
      novels: [],
      currentNovel: null,
      chapters: [],
      currentChapter: null,
      lastError: null,
      timelines: [],
      events: [],
      selectedCursor: null,
      overlappingEvents: [],
      undo_history: [],
      undo_index: -1,
      searchQuery: '',
      timePointsByNovel: {},
      timePointConnectionsByNovel: {},
      bubbleEventsByNovel: {},
      eventDependenciesByNovel: {},
      timelineColumnWidthsByNovel: {},
      timelineVerticalMaxByNovel: {},
      layout_undo_history: [],
      layout_undo_index: -1,

      clearError: () => set({ lastError: null }),

      captureLayoutSnapshot: () => {
        set((state) => {
          const snapshot = buildLayoutSnapshot(state);
          if (!snapshot) return {};

          const base = state.layout_undo_history.slice(0, state.layout_undo_index + 1);
          const previous = base[base.length - 1];
          if (previous && sameLayoutSnapshot(previous, snapshot)) {
            return {};
          }

          const nextHistory = [...base, cloneLayoutSnapshot(snapshot)].slice(-MAX_LAYOUT_UNDO);
          return {
            layout_undo_history: nextHistory,
            layout_undo_index: nextHistory.length - 1
          };
        });
      },

      initialize: async () => {
        set({ lastError: null });
        try {
          const novels: Novel[] = await novelApi.listNovels();
          const persistedNovelId = get().currentNovel?.id;
          if (novels.length === 0) {
            resetCursorQueryState();
            set({
              novels: [],
              currentNovel: null,
              chapters: [],
              currentChapter: null,
              timelines: [],
              events: [],
              timePointsByNovel: {},
              timePointConnectionsByNovel: {},
              bubbleEventsByNovel: {},
              eventDependenciesByNovel: {}
            });
            return;
          }

          const selected = novels.find((novel: Novel) => novel.id === persistedNovelId) ?? novels[0];
          set({ novels });
          await get().selectNovel(selected.id);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      createNovel: async (name: string) => {
        set({ lastError: null });
        try {
          const created = await novelApi.createNovel({ name });
          const novels = await novelApi.listNovels();
          set({ novels });
          await get().selectNovel(created.id);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      selectNovel: async (novelId: string) => {
        set({ lastError: null });
        try {
          resetCursorQueryState();
          const payload: NovelPayload = await novelApi.getNovelPayload(novelId);
          const scoped = chapterScopedState(payload, null);
          set((state) => {
            const migrated = migrateLegacyLayoutScope(state, payload.novel.id, scoped.chapter?.id ?? null);
            return {
              ...migrated,
              currentNovel: payload.novel,
              chapters: payload.chapters,
              currentChapter: scoped.chapter,
              timelines: scoped.timelines,
              events: scoped.events,
              selectedCursor: null,
              overlappingEvents: [],
              undo_history: [snapshotFromPayload(payload, scoped.chapter?.id ?? null)],
              undo_index: 0,
              layout_undo_history: [],
              layout_undo_index: -1
            };
          });
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      selectChapter: async (chapterId: string) => {
        set({ lastError: null });
        try {
          const { currentNovel } = get();
          if (!currentNovel) return;

          resetCursorQueryState();
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const scoped = chapterScopedState(payload, chapterId);
          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            selectedCursor: null,
            overlappingEvents: []
          });
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      createChapter: async (name: string) => {
        set({ lastError: null });
        try {
          const { currentNovel, undo_history, undo_index } = get();
          if (!currentNovel) return;

          const created = await novelApi.createChapter({ novel_id: currentNovel.id, name: name.trim() });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const scoped = chapterScopedState(payload, created.id);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(undo_history, undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      renameChapter: async (chapterId: string, name: string) => {
        set({ lastError: null });
        try {
          const { currentNovel, currentChapter, undo_history, undo_index } = get();
          if (!currentNovel) return;
          const trimmed = name.trim();
          if (!trimmed) return;

          await novelApi.updateChapter({ id: chapterId, novel_id: currentNovel.id, name: trimmed });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const scoped = chapterScopedState(payload, currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(undo_history, undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      deleteChapter: async (chapterId: string) => {
        set({ lastError: null });
        try {
          const { currentNovel, currentChapter, undo_history, undo_index } = get();
          if (!currentNovel) return;

          await novelApi.deleteChapter(chapterId);
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const nextPreferred = currentChapter?.id === chapterId ? null : currentChapter?.id ?? null;
          const scoped = chapterScopedState(payload, nextPreferred);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(undo_history, undo_index, snapshot);

          resetCursorQueryState();
          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            selectedCursor: null,
            overlappingEvents: [],
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      createTimeline: async (name, color) => {
        set({ lastError: null });
        try {
          const { currentNovel, currentChapter } = get();
          if (!currentNovel || !currentChapter) return;

          await novelApi.createTimeline({
            novel_id: currentNovel.id,
            chapter_id: currentChapter.id,
            name,
            color
          });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, currentChapter.id);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      updateTimelineColor: async (timelineId, color) => {
        set({ lastError: null });
        try {
          const { currentNovel, timelines } = get();
          if (!currentNovel) return;

          const timeline = timelines.find((item) => item.id === timelineId);
          if (!timeline) return;

          await novelApi.updateTimeline({ ...timeline, color });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      updateTimelineName: async (timelineId, name) => {
        set({ lastError: null });
        try {
          const { currentNovel, timelines } = get();
          if (!currentNovel) return;
          const trimmed = name.trim();
          if (!trimmed) return;

          const timeline = timelines.find((item) => item.id === timelineId);
          if (!timeline) return;

          await novelApi.updateTimeline({ ...timeline, name: trimmed });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      createEvent: async (input) => {
        set({ lastError: null });
        try {
          const { currentNovel } = get();
          if (!currentNovel) return;

          await novelApi.createEvent({ ...input, novel_id: currentNovel.id });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      updateEvent: async (input) => {
        set({ lastError: null });
        try {
          const { currentNovel } = get();
          if (!currentNovel) return;

          await novelApi.updateEvent(input);
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      deleteEvent: async (eventId) => {
        set({ lastError: null });
        try {
          const { currentNovel } = get();
          if (!currentNovel) return;

          await novelApi.deleteEvent(eventId);
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      deleteTimeline: async (timelineId) => {
        set({ lastError: null });
        try {
          const { currentNovel } = get();
          if (!currentNovel) return;

          await novelApi.deleteTimeline(timelineId);
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      setCursor: async (cursorIso) => {
        const { currentNovel, currentChapter } = get();
        if (!currentNovel || !cursorIso) {
          resetCursorQueryState();
          set({ selectedCursor: cursorIso, overlappingEvents: [] });
          return;
        }

        set({ selectedCursor: cursorIso });

        const requestToken = cursorQueryToken + 1;
        cursorQueryToken = requestToken;
        if (cursorQueryTimer) {
          window.clearTimeout(cursorQueryTimer);
        }

        cursorQueryTimer = window.setTimeout(async () => {
          try {
            const overlaps = await novelApi.getOverlappingEvents(
              currentNovel.id,
              cursorIso,
              currentChapter?.id
            );
            const state = get();
            if (
              cursorQueryToken !== requestToken ||
              state.currentNovel?.id !== currentNovel.id ||
              state.selectedCursor !== cursorIso
            ) {
              return;
            }
            set({ overlappingEvents: overlaps });
          } catch {
            if (cursorQueryToken === requestToken) {
              set({ overlappingEvents: [], lastError: 'Failed to load overlap data.' });
            }
          }
        }, CURSOR_QUERY_DEBOUNCE_MS);
      },

      setSearchQuery: (query) => set({ searchQuery: query }),

      undo: async () => {
        set({ lastError: null });
        try {
          const layoutState = get();
          if (layoutState.layout_undo_index > 0) {
            const nextIndex = layoutState.layout_undo_index - 1;
            const snapshot = layoutState.layout_undo_history[nextIndex];
            set((state) => ({
              timePointsByNovel: {
                ...state.timePointsByNovel,
                [snapshot.scopeKey]: snapshot.points.map((point) => ({ ...point }))
              },
              timePointConnectionsByNovel: {
                ...state.timePointConnectionsByNovel,
                [snapshot.scopeKey]: snapshot.connections.map((connection) => ({ ...connection }))
              },
              bubbleEventsByNovel: {
                ...state.bubbleEventsByNovel,
                [snapshot.scopeKey]: snapshot.bubbles.map((bubble) => ({ ...bubble }))
              },
              eventDependenciesByNovel: {
                ...state.eventDependenciesByNovel,
                [snapshot.scopeKey]: snapshot.dependencies.map((dep) => ({ ...dep }))
              },
              timelineColumnWidthsByNovel: {
                ...state.timelineColumnWidthsByNovel,
                [snapshot.scopeKey]: { ...snapshot.columnWidths }
              },
              timelineVerticalMaxByNovel: {
                ...state.timelineVerticalMaxByNovel,
                [snapshot.scopeKey]: snapshot.verticalMax
              },
              layout_undo_index: nextIndex
            }));
            return;
          }

          const { undo_index, undo_history, currentNovel } = get();
          if (!currentNovel || undo_index <= 0) return;

          const nextIndex = undo_index - 1;
          const snapshot = undo_history[nextIndex];
          const payload: NovelPayload = {
            novel: snapshot.novel,
            chapters: snapshot.chapters,
            timelines: snapshot.timelines,
            events: snapshot.events
          };

          await novelApi.replacePayload(payload);
          const scoped = chapterScopedState(payload, snapshot.currentChapterId);
          set({
            currentNovel: payload.novel,
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_index: nextIndex
          });
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      redo: async () => {
        set({ lastError: null });
        try {
          const layoutState = get();
          if (layoutState.layout_undo_index >= 0 && layoutState.layout_undo_index < layoutState.layout_undo_history.length - 1) {
            const nextIndex = layoutState.layout_undo_index + 1;
            const snapshot = layoutState.layout_undo_history[nextIndex];
            set((state) => ({
              timePointsByNovel: {
                ...state.timePointsByNovel,
                [snapshot.scopeKey]: snapshot.points.map((point) => ({ ...point }))
              },
              timePointConnectionsByNovel: {
                ...state.timePointConnectionsByNovel,
                [snapshot.scopeKey]: snapshot.connections.map((connection) => ({ ...connection }))
              },
              bubbleEventsByNovel: {
                ...state.bubbleEventsByNovel,
                [snapshot.scopeKey]: snapshot.bubbles.map((bubble) => ({ ...bubble }))
              },
              eventDependenciesByNovel: {
                ...state.eventDependenciesByNovel,
                [snapshot.scopeKey]: snapshot.dependencies.map((dep) => ({ ...dep }))
              },
              timelineColumnWidthsByNovel: {
                ...state.timelineColumnWidthsByNovel,
                [snapshot.scopeKey]: { ...snapshot.columnWidths }
              },
              timelineVerticalMaxByNovel: {
                ...state.timelineVerticalMaxByNovel,
                [snapshot.scopeKey]: snapshot.verticalMax
              },
              layout_undo_index: nextIndex
            }));
            return;
          }

          const { undo_index, undo_history, currentNovel } = get();
          if (!currentNovel || undo_index >= undo_history.length - 1) return;

          const nextIndex = undo_index + 1;
          const snapshot = undo_history[nextIndex];
          const payload: NovelPayload = {
            novel: snapshot.novel,
            chapters: snapshot.chapters,
            timelines: snapshot.timelines,
            events: snapshot.events
          };

          await novelApi.replacePayload(payload);
          const scoped = chapterScopedState(payload, snapshot.currentChapterId);

          set({
            currentNovel: payload.novel,
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_index: nextIndex
          });
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      exportNovelJson: async () => {
        set({ lastError: null });
        try {
          const novel = get().currentNovel;
          if (!novel) return;
          await novelApi.exportNovelJson(novel.id);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      exportTimelineCsv: async (timelineId) => {
        set({ lastError: null });
        try {
          const novel = get().currentNovel;
          if (!novel) return;
          await novelApi.exportTimelineCsv(novel.id, timelineId);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      importNovelJson: async () => {
        set({ lastError: null });
        try {
          const result = await novelApi.importNovelJson();
          if (result?.canceled || !result?.novelId) return;
          const novels = await novelApi.listNovels();
          set({ novels });
          await get().selectNovel(result.novelId);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      addTimePoint: (label, position, timelineId) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const verticalMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
        const existing = get().timePointsByNovel[scopeKey] ?? [];
        const point: TimePoint = {
          id: uuidv4(),
          label: label.trim(),
          position: clampPosition(position, verticalMax),
          timeline_id: timelineId
        };
        const next = [...existing, point].sort((a, b) => a.position - b.position);
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [scopeKey]: next
          }
        });
      },

      updateTimePoint: (id, label) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const existing = get().timePointsByNovel[scopeKey] ?? [];
        const next = existing.map((point) => (point.id === id ? { ...point, label: label.trim() } : point));
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [scopeKey]: next
          }
        });
      },

      updateTimePointPosition: (id, position) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const existing = get().timePointsByNovel[scopeKey] ?? [];
        const verticalMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
        const clamped = clampPosition(position, verticalMax);
        const connections = get().timePointConnectionsByNovel[scopeKey] ?? [];

        // Move all points in the connected component so linked points stay horizontally aligned.
        const linkedIds = new Set<string>([id]);
        const queue: string[] = [id];
        while (queue.length > 0) {
          const current = queue.shift() as string;
          connections.forEach((connection) => {
            const neighbor =
              connection.from_point_id === current
                ? connection.to_point_id
                : connection.to_point_id === current
                  ? connection.from_point_id
                  : null;
            if (neighbor && !linkedIds.has(neighbor)) {
              linkedIds.add(neighbor);
              queue.push(neighbor);
            }
          });
        }

        const next = existing
          .map((point) => (linkedIds.has(point.id) ? { ...point, position: clamped } : point))
          .sort((a, b) => a.position - b.position);
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [scopeKey]: next
          }
        });
      },

      deleteTimePoint: (id) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const existing = get().timePointsByNovel[scopeKey] ?? [];
        const next = existing.filter((point) => point.id !== id);
        const connections = get().timePointConnectionsByNovel[scopeKey] ?? [];
        const nextConnections = connections.filter(
          (connection) => connection.from_point_id !== id && connection.to_point_id !== id
        );

        const bubbleEvents = get().bubbleEventsByNovel[scopeKey] ?? [];
        const reanchoredEvents = bubbleEvents
          .map((event) => {
            if (event.anchor_point_id !== id) return event;
            const nextAnchor = selectAnchorPoint(next, event.timeline_id, event.offset);
            if (!nextAnchor) return null;
            return {
              ...event,
              anchor_point_id: nextAnchor.id,
              offset: event.offset
            };
          })
          .filter((event): event is TimelineBubbleEvent => event !== null);

        const remainingEventIds = new Set(reanchoredEvents.map((event) => event.id));
        const deps = get().eventDependenciesByNovel[scopeKey] ?? [];
        const nextDeps = deps.filter(
          (dep) => remainingEventIds.has(dep.from_event_id) && remainingEventIds.has(dep.to_event_id)
        );

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [scopeKey]: next
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [scopeKey]: nextConnections
          },
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: reanchoredEvents
          },
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [scopeKey]: nextDeps
          }
        });
      },

      addTimePointConnection: (fromPointId, toPointId) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey || fromPointId === toPointId) return;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const from = points.find((point) => point.id === fromPointId);
        const to = points.find((point) => point.id === toPointId);
        if (!from || !to || from.timeline_id === to.timeline_id) return;

        const existing = get().timePointConnectionsByNovel[scopeKey] ?? [];
        const alreadyExists = existing.some(
          (connection) =>
            (connection.from_point_id === fromPointId && connection.to_point_id === toPointId) ||
            (connection.from_point_id === toPointId && connection.to_point_id === fromPointId)
        );
        if (alreadyExists) return;

        const nextConnections: TimePointConnection[] = [
          ...existing,
          {
            id: uuidv4(),
            from_point_id: fromPointId,
            to_point_id: toPointId
          }
        ];

        // Snap linked points to the same vertical position at the moment they are connected.
        const alignedPosition = from.position;
        const nextPoints = points
          .map((point) =>
            point.id === fromPointId || point.id === toPointId
              ? { ...point, position: alignedPosition }
              : point
          )
          .sort((a, b) => a.position - b.position);

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [scopeKey]: nextPoints
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [scopeKey]: nextConnections
          }
        });
      },

      addBubbleEvent: (title, timelineId, preferredPosition) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey || !title.trim()) return false;
        const verticalMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const clampedPreferred = clampPosition(preferredPosition, verticalMax);
        const anchor = selectAnchorPoint(points, timelineId, clampedPreferred);
        if (!anchor) return false;

        const existing = get().bubbleEventsByNovel[scopeKey] ?? [];
        const sameTimelineCount = existing.filter((event) => event.timeline_id === timelineId).length;
        const offset = clampedPreferred - anchor.position;
        const next: TimelineBubbleEvent[] = [
          ...existing,
          {
            id: uuidv4(),
            timeline_id: timelineId,
            anchor_point_id: anchor.id,
            title: title.trim(),
            side: sameTimelineCount % 2 === 0 ? 'right' : 'left',
            offset
          }
        ];

        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: next
          }
        });
        return true;
      },

      updateBubbleEventTitle: (eventId, title) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const existing = get().bubbleEventsByNovel[scopeKey] ?? [];
        const next = existing.map((event) => (event.id === eventId ? { ...event, title: trimmed } : event));
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: next
          }
        });
      },

      moveBubbleEvent: (eventId, nextPosition) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return false;
        const verticalMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const bubbles = get().bubbleEventsByNovel[scopeKey] ?? [];
        const deps = get().eventDependenciesByNovel[scopeKey] ?? [];
        const target = bubbles.find((event) => event.id === eventId);
        if (!target) return false;
        const pointsById = new Map(points.map((point) => [point.id, point]));
        const currentCenter = bubblePosition(target, pointsById);
        const clamped = clampPosition(nextPosition, verticalMax);
        const delta = clamped - currentCenter;
        const linkedEventIds = connectedHorizontalDependencyEventIds(eventId, deps, bubbles);

        for (let i = 0; i < bubbles.length; i += 1) {
          const bubble = bubbles[i];
          if (!linkedEventIds.has(bubble.id)) continue;
          if (!selectAnchorPoint(points, bubble.timeline_id, clamped)) {
            return false;
          }
        }

        const next = bubbles.map((event) =>
          linkedEventIds.has(event.id)
            ? desiredBubblePosition(
                event,
                clampPosition(bubblePosition(event, pointsById) + delta, verticalMax),
                points,
                verticalMax
              )
            : event
        );

        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: next
          }
        });
        return true;
      },

      settleBubbleEventPosition: (eventId) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return false;
        const verticalMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const bubbles = get().bubbleEventsByNovel[scopeKey] ?? [];
        const deps = get().eventDependenciesByNovel[scopeKey] ?? [];
        const target = bubbles.find((event) => event.id === eventId);
        if (!target) return false;

        const pointsById = new Map(points.map((point) => [point.id, point]));
        const currentPosition = bubblePosition(target, pointsById);
        const sameTimeline = bubbles.filter((event) => event.timeline_id === target.timeline_id);
        const untouched = bubbles.filter((event) => event.timeline_id !== target.timeline_id);
        const sideLockById = new Map<string, 'above' | 'below'>(
          sameTimeline
            .filter((event) => event.id !== eventId)
            .map((event) => [event.id, event.offset < 0 ? 'above' : 'below'])
        );
        const resolved = resolveTimelineBubbleCollisions(
          sameTimeline,
          eventId,
          currentPosition,
          currentPosition,
          points,
          sideLockById,
          verticalMax
        );
        const resolvedZones: BubbleZone[] = resolved.map((event) => ({
          id: event.id,
          timeline_id: event.timeline_id,
          center: bubblePosition(event, pointsById),
          clearance: pointClearance(event)
        }));
        const timelinePoints = points.filter((point) => point.timeline_id === target.timeline_id);
        const { nextPoints: shiftedTimelinePoints } = slideTimelinePointsFromBubbles(
          timelinePoints,
          resolved,
          eventId,
          currentPosition,
          verticalMax
        );

        const shiftedPointById = new Map(shiftedTimelinePoints.map((point) => [point.id, point]));
        const candidatePoints = points.map((point) => shiftedPointById.get(point.id) ?? point);
        const connections = get().timePointConnectionsByNovel[scopeKey] ?? [];
        const alignedPoints = alignConnectedPoints(points, candidatePoints, connections, verticalMax);
        const nextPoints = enforceComponentPointClearance(
          alignedPoints,
          connections,
          resolvedZones,
          eventId,
          verticalMax
        );

        const finalById = new Map(nextPoints.map((point) => [point.id, point]));
        const finalDeltas = new Map<string, number>();
        points.forEach((point) => {
          const moved = finalById.get(point.id);
          if (!moved) return;
          const delta = moved.position - point.position;
          if (Math.abs(delta) > 0.000001) {
            finalDeltas.set(point.id, delta);
          }
        });

        const compensatedResolved = resolved.map((event) => {
          const delta = finalDeltas.get(event.anchor_point_id);
          if (!delta) return event;
          return {
            ...event,
            offset: event.offset - delta
          };
        });

        const finalPointsById = new Map(nextPoints.map((point) => [point.id, point]));
        const scopeClampedResolved = compensatedResolved.map((event) => {
          if (event.id === eventId) return event;
          const lock = sideLockById.get(event.id);
          const proxyEvent =
            lock == null
              ? event
              : {
                  ...event,
                  offset: lock === 'above' ? -Math.abs(event.offset || BASE_MIN_GAP) : Math.abs(event.offset || BASE_MIN_GAP)
                };
          const bounds = eventScopeBounds(proxyEvent, nextPoints, verticalMax);
          const currentPos = bubblePosition(event, finalPointsById);
          const clampedPos = Math.max(bounds.min, Math.min(bounds.max, currentPos));
          if (Math.abs(clampedPos - currentPos) < 0.000001) return event;
          return anchoredBubblePosition(event, clampedPos, finalPointsById, nextPoints, verticalMax);
        });

        const movingAfterClamp = scopeClampedResolved.find((event) => event.id === eventId);
        if (!movingAfterClamp) return false;
        const stabilizedResolved = resolveTimelineBubbleCollisions(
          scopeClampedResolved,
          eventId,
          currentPosition,
          currentPosition,
          nextPoints,
          sideLockById,
          verticalMax
        );

        const stabilizedPointsById = new Map(nextPoints.map((point) => [point.id, point]));
        const stabilizedZones: BubbleZone[] = stabilizedResolved.map((event) => ({
          id: event.id,
          timeline_id: event.timeline_id,
          center: bubblePosition(event, stabilizedPointsById),
          clearance: pointClearance(event)
        }));

        const clearedPoints = enforceComponentPointClearance(
          nextPoints,
          connections,
          stabilizedZones,
          eventId,
          verticalMax
        );

        const nextPointsById = new Map(nextPoints.map((point) => [point.id, point]));
        const clearedPointsById = new Map(clearedPoints.map((point) => [point.id, point]));
        const finalizedResolved = stabilizedResolved.map((event) => {
          const before = nextPointsById.get(event.anchor_point_id);
          const after = clearedPointsById.get(event.anchor_point_id);
          if (!before || !after) return event;
          const delta = after.position - before.position;
          if (Math.abs(delta) < 0.000001) return event;
          return {
            ...event,
            offset: event.offset - delta
          };
        });

        const nextBase = [...untouched, ...finalizedResolved];
        const linkedEventIds = connectedHorizontalDependencyEventIds(eventId, deps, nextBase);
        const clearedPointsByIdFinal = new Map(clearedPoints.map((point) => [point.id, point]));
        const movingEvent = nextBase.find((event) => event.id === eventId);
        const movingCenter = movingEvent
          ? bubblePosition(movingEvent, clearedPointsByIdFinal)
          : currentPosition;
        const next = nextBase.map((event) => {
          if (!linkedEventIds.has(event.id) || event.id === eventId) {
            return event;
          }
          const currentPos = bubblePosition(event, clearedPointsByIdFinal);
          const delta = movingCenter - currentPosition;
          return desiredBubblePosition(
            event,
            clampPosition(currentPos + delta, verticalMax),
            clearedPoints,
            verticalMax
          );
        });

        const unstuck = spreadCoincidentEvents(next, clearedPoints, verticalMax);

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [scopeKey]: clearedPoints
          },
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: unstuck
          }
        });
        return true;
      },

      deleteBubbleEvent: (eventId) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const events = get().bubbleEventsByNovel[scopeKey] ?? [];
        const nextEvents = events.filter((event) => event.id !== eventId);
        const deps = get().eventDependenciesByNovel[scopeKey] ?? [];
        const nextDeps = deps.filter((dep) => dep.from_event_id !== eventId && dep.to_event_id !== eventId);
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: nextEvents
          },
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [scopeKey]: nextDeps
          }
        });
      },

      addEventDependency: (fromEventId, toEventId) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey || fromEventId === toEventId) return false;

        const events = get().bubbleEventsByNovel[scopeKey] ?? [];
        const deps = get().eventDependenciesByNovel[scopeKey] ?? [];
        const from = events.find((event) => event.id === fromEventId);
        const to = events.find((event) => event.id === toEventId);
        if (!from || !to) return false;

        const exists = deps.some(
          (dep) => dep.from_event_id === fromEventId && dep.to_event_id === toEventId
        );
        if (exists) return true;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const pointsById = new Map(points.map((point) => [point.id, point]));
        const fromPos = bubblePosition(from, pointsById);
        const toPos = bubblePosition(to, pointsById);
        const orderedFrom = fromPos <= toPos ? from : to;
        const orderedTo = fromPos <= toPos ? to : from;

        const nextDeps: TimelineEventDependency[] = [
          ...deps,
          {
            id: uuidv4(),
            timeline_id: orderedFrom.timeline_id,
            from_event_id: orderedFrom.id,
            to_event_id: orderedTo.id
          }
        ];

        set({
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [scopeKey]: nextDeps
          }
        });
        return true;
      },

      deleteEventDependency: (dependencyId) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const deps = get().eventDependenciesByNovel[scopeKey] ?? [];
        const nextDeps = deps.filter((dep) => dep.id !== dependencyId);
        set({
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [scopeKey]: nextDeps
          }
        });
      },

      setBubbleEventSide: (eventId, side) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const events = get().bubbleEventsByNovel[scopeKey] ?? [];
        const nextEvents = events.map((event) => (event.id === eventId ? { ...event, side } : event));
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: nextEvents
          }
        });
      },

      repairCollapsedBubbleEvents: () => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return false;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const events = get().bubbleEventsByNovel[scopeKey] ?? [];
        const verticalMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
        const repaired = spreadCoincidentEvents(events, points, verticalMax);

        if (JSON.stringify(repaired) === JSON.stringify(events)) {
          return false;
        }

        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [scopeKey]: repaired
          }
        });
        return true;
      },

      setTimelineColumnWidth: (timelineId, width) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return;
        const clamped = Math.max(150, Math.min(480, Math.round(width)));
        const existing = get().timelineColumnWidthsByNovel[scopeKey] ?? {};
        set({
          timelineColumnWidthsByNovel: {
            ...get().timelineColumnWidthsByNovel,
            [scopeKey]: {
              ...existing,
              [timelineId]: clamped
            }
          }
        });
      },

      ensureTimelineVerticalExtent: (requestedPosition) => {
        const scopeKey = currentLayoutScopeKey(get());
        if (!scopeKey) return DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[scopeKey] ?? [];
        const bubbles = get().bubbleEventsByNovel[scopeKey] ?? [];
        const contentMax = timelineContentMaxPosition(points, bubbles);

        const currentMax =
          get().timelineVerticalMaxByNovel[scopeKey] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
        const safeRequested = Math.max(0, requestedPosition);
        const desiredContentMax = Math.max(contentMax, safeRequested);

        const headroomCap = Math.max(
          DEFAULT_TIMELINE_VERTICAL_MAX,
          Math.min(VERTICAL_MAX_HARD_LIMIT, desiredContentMax + VERTICAL_HEADROOM_VIEWPORTS)
        );
        const growthFloor = Math.max(currentMax, safeRequested + VERTICAL_MIN_FORWARD_BUFFER);
        let nextMax = currentMax;

        if (safeRequested >= currentMax - VERTICAL_MIN_FORWARD_BUFFER) {
          nextMax = Math.min(
            headroomCap,
            Math.max(growthFloor, currentMax + VERTICAL_EDGE_GROWTH_CHUNK)
          );
        }

        const tightened = Math.max(DEFAULT_TIMELINE_VERTICAL_MAX, Math.min(nextMax, headroomCap));

        if (Math.abs(tightened - currentMax) < 0.000001) {
          return currentMax;
        }

        set({
          timelineVerticalMaxByNovel: {
            ...get().timelineVerticalMaxByNovel,
            [scopeKey]: tightened
          }
        });
        return tightened;
      },

      reorderTimelines: async (sourceTimelineId, targetTimelineId, dropPosition) => {
        set({ lastError: null });
        try {
          if (sourceTimelineId === targetTimelineId) return;
          const { timelines, currentNovel } = get();
          const sourceIndex = timelines.findIndex((item) => item.id === sourceTimelineId);
          if (sourceIndex < 0 || !currentNovel) return;

          const withoutSource = [...timelines];
          const [moved] = withoutSource.splice(sourceIndex, 1);
          const targetIndex = withoutSource.findIndex((item) => item.id === targetTimelineId);
          if (!moved || targetIndex < 0) return;

          const insertIndex = targetIndex + (dropPosition === 'after' ? 1 : 0);
          const reordered = [...withoutSource];
          reordered.splice(insertIndex, 0, moved);

          const nextTimelines = reordered.map((timeline, index) => ({
            ...timeline,
            order_index: index
          }));

          set({ timelines: nextTimelines });
          await Promise.all(nextTimelines.map((timeline) => novelApi.updateTimeline(timeline)));

          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const scoped = chapterScopedState(payload, state.currentChapter?.id ?? null);
          const snapshot = snapshotFromPayload(payload, scoped.chapter?.id ?? null);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);
          set({
            chapters: payload.chapters,
            currentChapter: scoped.chapter,
            timelines: scoped.timelines,
            events: scoped.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      }
    }),
    {
      name: 'novelic-ui-cache',
      partialize: (state) => ({
        currentNovel: state.currentNovel,
        currentChapter: state.currentChapter,
        selectedCursor: state.selectedCursor,
        searchQuery: state.searchQuery,
        timePointsByNovel: state.timePointsByNovel,
        timePointConnectionsByNovel: state.timePointConnectionsByNovel,
        bubbleEventsByNovel: state.bubbleEventsByNovel,
        eventDependenciesByNovel: state.eventDependenciesByNovel,
        timelineColumnWidthsByNovel: state.timelineColumnWidthsByNovel,
        timelineVerticalMaxByNovel: state.timelineVerticalMaxByNovel
      })
    }
  )
);

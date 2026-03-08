import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
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
  canMoveBubbleEvent,
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
  clearError: () => void;
  initialize: () => Promise<void>;
  createNovel: (name: string) => Promise<void>;
  selectNovel: (novelId: string) => Promise<void>;
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
  setTimelineColumnWidth: (timelineId: string, width: number) => void;
  ensureTimelineVerticalExtent: (requestedPosition: number) => number;
  reorderTimelines: (
    sourceTimelineId: string,
    targetTimelineId: string,
    dropPosition: 'before' | 'after'
  ) => Promise<void>;
}

const CURSOR_QUERY_DEBOUNCE_MS = 80;
const DEFAULT_TIMELINE_VERTICAL_MAX = 1;
const VERTICAL_EDGE_GROWTH_CHUNK = 0.25;
const VERTICAL_HEADROOM_VIEWPORTS = 1;
const VERTICAL_MIN_FORWARD_BUFFER = 0.2;
const VERTICAL_MAX_HARD_LIMIT = 24;

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

async function pushSnapshotToDb(snapshot: LocalSnapshot): Promise<void> {
  await novelApi.createSnapshot(snapshot.novel.id, serializeSnapshot(snapshot));
}

export const useNovelStore = create<NovelStore>()(
  persist(
    (set, get) => ({
      novels: [],
      currentNovel: null,
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

      clearError: () => set({ lastError: null }),

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
          set({
            currentNovel: payload.novel,
            timelines: payload.timelines,
            events: payload.events,
            selectedCursor: null,
            overlappingEvents: [],
            undo_history: [snapshotFromPayload(payload)],
            undo_index: 0
          });
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      createTimeline: async (name, color) => {
        set({ lastError: null });
        try {
          const { currentNovel } = get();
          if (!currentNovel) return;

          await novelApi.createTimeline({ novel_id: currentNovel.id, name, color });
          const payload: NovelPayload = await novelApi.getNovelPayload(currentNovel.id);
          const state = get();
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            timelines: payload.timelines,
            events: payload.events,
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            timelines: payload.timelines,
            events: payload.events,
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            timelines: payload.timelines,
            events: payload.events,
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

          set({
            timelines: payload.timelines,
            events: payload.events,
            undo_history: bounded,
            undo_index: bounded.length - 1
          });
          await pushSnapshotToDb(snapshot);
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      setCursor: async (cursorIso) => {
        const { currentNovel } = get();
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
            const overlaps = await novelApi.getOverlappingEvents(currentNovel.id, cursorIso);
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
          const { undo_index, undo_history, currentNovel } = get();
          if (!currentNovel || undo_index <= 0) return;

          const nextIndex = undo_index - 1;
          const snapshot = undo_history[nextIndex];
          const payload: NovelPayload = {
            novel: snapshot.novel,
            timelines: snapshot.timelines,
            events: snapshot.events
          };

          await novelApi.replacePayload(payload);
          set({
            currentNovel: payload.novel,
            timelines: payload.timelines,
            events: payload.events,
            undo_index: nextIndex
          });
        } catch (error) {
          set({ lastError: toErrorMessage(error) });
        }
      },

      redo: async () => {
        set({ lastError: null });
        try {
          const { undo_index, undo_history, currentNovel } = get();
          if (!currentNovel || undo_index >= undo_history.length - 1) return;

          const nextIndex = undo_index + 1;
          const snapshot = undo_history[nextIndex];
          const payload: NovelPayload = {
            novel: snapshot.novel,
            timelines: snapshot.timelines,
            events: snapshot.events
          };

          await novelApi.replacePayload(payload);

          set({
            currentNovel: payload.novel,
            timelines: payload.timelines,
            events: payload.events,
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
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const verticalMax =
          get().timelineVerticalMaxByNovel[novelId] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
        const existing = get().timePointsByNovel[novelId] ?? [];
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
            [novelId]: next
          }
        });
      },

      updateTimePoint: (id, label) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const next = existing.map((point) => (point.id === id ? { ...point, label: label.trim() } : point));
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          }
        });
      },

      updateTimePointPosition: (id, position) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const verticalMax =
          get().timelineVerticalMaxByNovel[novelId] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
        const clamped = clampPosition(position, verticalMax);
        const connections = get().timePointConnectionsByNovel[novelId] ?? [];

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
            [novelId]: next
          }
        });
      },

      deleteTimePoint: (id) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const next = existing.filter((point) => point.id !== id);
        const connections = get().timePointConnectionsByNovel[novelId] ?? [];
        const nextConnections = connections.filter(
          (connection) => connection.from_point_id !== id && connection.to_point_id !== id
        );

        const bubbleEvents = get().bubbleEventsByNovel[novelId] ?? [];
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
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const nextDeps = deps.filter(
          (dep) => remainingEventIds.has(dep.from_event_id) && remainingEventIds.has(dep.to_event_id)
        );

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [novelId]: nextConnections
          },
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: reanchoredEvents
          },
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
      },

      addTimePointConnection: (fromPointId, toPointId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId || fromPointId === toPointId) return;

        const points = get().timePointsByNovel[novelId] ?? [];
        const from = points.find((point) => point.id === fromPointId);
        const to = points.find((point) => point.id === toPointId);
        if (!from || !to || from.timeline_id === to.timeline_id) return;

        const existing = get().timePointConnectionsByNovel[novelId] ?? [];
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
            [novelId]: nextPoints
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [novelId]: nextConnections
          }
        });
      },

      addBubbleEvent: (title, timelineId, preferredPosition) => {
        const novelId = get().currentNovel?.id;
        if (!novelId || !title.trim()) return false;
        const verticalMax =
          get().timelineVerticalMaxByNovel[novelId] ?? DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[novelId] ?? [];
        const clampedPreferred = clampPosition(preferredPosition, verticalMax);
        const anchor = selectAnchorPoint(points, timelineId, clampedPreferred);
        if (!anchor) return false;

        const existing = get().bubbleEventsByNovel[novelId] ?? [];
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
            [novelId]: next
          }
        });
        return true;
      },

      updateBubbleEventTitle: (eventId, title) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const existing = get().bubbleEventsByNovel[novelId] ?? [];
        const next = existing.map((event) => (event.id === eventId ? { ...event, title: trimmed } : event));
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
      },

      moveBubbleEvent: (eventId, nextPosition) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return false;
        const verticalMax =
          get().timelineVerticalMaxByNovel[novelId] ?? DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[novelId] ?? [];
        const bubbles = get().bubbleEventsByNovel[novelId] ?? [];
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const target = bubbles.find((event) => event.id === eventId);
        if (!target) return false;

        if (!selectAnchorPoint(points, target.timeline_id, nextPosition)) return false;

        const pointsById = new Map(points.map((point) => [point.id, point]));
        const clamped = clampPosition(nextPosition, verticalMax);
        if (!canMoveBubbleEvent(target, clamped, bubbles, deps, pointsById)) return false;

        const next = bubbles.map((event) =>
          event.id === eventId
            ? desiredBubblePosition(event, clamped, points, verticalMax)
            : event
        );

        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
        return true;
      },

      settleBubbleEventPosition: (eventId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return false;
        const verticalMax =
          get().timelineVerticalMaxByNovel[novelId] ?? DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[novelId] ?? [];
        const bubbles = get().bubbleEventsByNovel[novelId] ?? [];
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
        const connections = get().timePointConnectionsByNovel[novelId] ?? [];
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

        const next = [...untouched, ...finalizedResolved];

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: clearedPoints
          },
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
        return true;
      },

      deleteBubbleEvent: (eventId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const events = get().bubbleEventsByNovel[novelId] ?? [];
        const nextEvents = events.filter((event) => event.id !== eventId);
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const nextDeps = deps.filter((dep) => dep.from_event_id !== eventId && dep.to_event_id !== eventId);
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: nextEvents
          },
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
      },

      addEventDependency: (fromEventId, toEventId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId || fromEventId === toEventId) return false;

        const events = get().bubbleEventsByNovel[novelId] ?? [];
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const from = events.find((event) => event.id === fromEventId);
        const to = events.find((event) => event.id === toEventId);
        if (!from || !to || from.timeline_id !== to.timeline_id) return false;

        const exists = deps.some(
          (dep) => dep.from_event_id === fromEventId && dep.to_event_id === toEventId
        );
        if (exists) return true;

        const points = get().timePointsByNovel[novelId] ?? [];
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
            [novelId]: nextDeps
          }
        });
        return true;
      },

      deleteEventDependency: (dependencyId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const nextDeps = deps.filter((dep) => dep.id !== dependencyId);
        set({
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
      },

      setBubbleEventSide: (eventId, side) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const events = get().bubbleEventsByNovel[novelId] ?? [];
        const nextEvents = events.map((event) => (event.id === eventId ? { ...event, side } : event));
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: nextEvents
          }
        });
      },

      setTimelineColumnWidth: (timelineId, width) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const clamped = Math.max(150, Math.min(480, Math.round(width)));
        const existing = get().timelineColumnWidthsByNovel[novelId] ?? {};
        set({
          timelineColumnWidthsByNovel: {
            ...get().timelineColumnWidthsByNovel,
            [novelId]: {
              ...existing,
              [timelineId]: clamped
            }
          }
        });
      },

      ensureTimelineVerticalExtent: (requestedPosition) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return DEFAULT_TIMELINE_VERTICAL_MAX;

        const points = get().timePointsByNovel[novelId] ?? [];
        const bubbles = get().bubbleEventsByNovel[novelId] ?? [];
        const contentMax = timelineContentMaxPosition(points, bubbles);

        const currentMax =
          get().timelineVerticalMaxByNovel[novelId] ?? DEFAULT_TIMELINE_VERTICAL_MAX;
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
            [novelId]: tightened
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
          const snapshot = snapshotFromPayload(payload);
          const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);
          set({
            timelines: payload.timelines,
            events: payload.events,
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

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

interface TimePoint {
  id: string;
  label: string;
  position: number;
  timeline_id: string;
}

interface TimePointConnection {
  id: string;
  from_point_id: string;
  to_point_id: string;
}

interface LocalSnapshot {
  novel: Novel;
  timelines: Timeline[];
  events: TimelineEvent[];
}

function cloneSnapshot(snapshot: LocalSnapshot): LocalSnapshot {
  return {
    novel: { ...snapshot.novel },
    timelines: snapshot.timelines.map((timeline) => ({ ...timeline })),
    events: snapshot.events.map((event) => ({ ...event }))
  };
}

interface NovelStore {
  novels: Novel[];
  currentNovel: Novel | null;
  timelines: Timeline[];
  events: TimelineEvent[];
  selectedCursor: string | null;
  overlappingEvents: TimelineEvent[];
  undo_history: LocalSnapshot[];
  undo_index: number;
  searchQuery: string;
  timePointsByNovel: Record<string, TimePoint[]>;
  timePointConnectionsByNovel: Record<string, TimePointConnection[]>;
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
}

const MAX_UNDO = 50;

function makeSnapshot(state: NovelStore): LocalSnapshot | null {
  if (!state.currentNovel) {
    return null;
  }
  return {
    novel: { ...state.currentNovel },
    timelines: state.timelines.map((timeline) => ({ ...timeline })),
    events: state.events.map((event) => ({ ...event }))
  };
}

function snapshotFromPayload(payload: NovelPayload): LocalSnapshot {
  return {
    novel: { ...payload.novel },
    timelines: payload.timelines.map((timeline) => ({ ...timeline })),
    events: payload.events.map((event) => ({ ...event }))
  };
}

function serializeSnapshot(snapshot: LocalSnapshot): string {
  return JSON.stringify(snapshot);
}

async function pushSnapshotToDb(snapshot: LocalSnapshot): Promise<void> {
  await window.novelic.state.createSnapshot(snapshot.novel.id, serializeSnapshot(snapshot));
}

function appendHistory(history: LocalSnapshot[], undoIndex: number, snapshot: LocalSnapshot): LocalSnapshot[] {
  const base = history.slice(0, undoIndex + 1);
  const next = [...base, cloneSnapshot(snapshot)];
  return next.slice(-MAX_UNDO);
}

export const useNovelStore = create<NovelStore>()(
  persist(
    (set, get) => ({
      novels: [],
      currentNovel: null,
      timelines: [],
      events: [],
      selectedCursor: null,
      overlappingEvents: [],
      undo_history: [],
      undo_index: -1,
      searchQuery: '',
      timePointsByNovel: {},
      timePointConnectionsByNovel: {},

      initialize: async () => {
        const novels: Novel[] = await window.novelic.novels.list();
        const persistedNovelId = get().currentNovel?.id;
        if (novels.length === 0) {
          set({
            novels: [],
            currentNovel: null,
            timelines: [],
            events: [],
            timePointsByNovel: {},
            timePointConnectionsByNovel: {}
          });
          return;
        }

        const selected = novels.find((novel: Novel) => novel.id === persistedNovelId) ?? novels[0];
        set({ novels });
        await get().selectNovel(selected.id);
      },

      createNovel: async (name: string) => {
        const created = await window.novelic.novels.create({ name });
        const novels = await window.novelic.novels.list();
        set({ novels });
        await get().selectNovel(created.id);
      },

      selectNovel: async (novelId: string) => {
        const payload: NovelPayload = await window.novelic.novels.getPayload(novelId);
        set({
          currentNovel: payload.novel,
          timelines: payload.timelines,
          events: payload.events,
          selectedCursor: null,
          overlappingEvents: [],
          undo_history: [snapshotFromPayload(payload)],
          undo_index: 0
        });
      },

      createTimeline: async (name, color) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.timelines.create({ novel_id: currentNovel.id, name, color });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
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
      },

      updateTimelineColor: async (timelineId, color) => {
        const { currentNovel, timelines } = get();
        if (!currentNovel) return;

        const timeline = timelines.find((item) => item.id === timelineId);
        if (!timeline) return;

        await window.novelic.timelines.update({ ...timeline, color });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        set({ timelines: payload.timelines, events: payload.events });
      },

      updateTimelineName: async (timelineId, name) => {
        const { currentNovel, timelines } = get();
        if (!currentNovel) return;
        const trimmed = name.trim();
        if (!trimmed) return;

        const timeline = timelines.find((item) => item.id === timelineId);
        if (!timeline) return;

        await window.novelic.timelines.update({ ...timeline, name: trimmed });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        set({ timelines: payload.timelines, events: payload.events });
      },

      createEvent: async (input) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.events.create({ ...input, novel_id: currentNovel.id });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
        await pushSnapshotToDb(snapshot);
      },

      updateEvent: async (input) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.events.update(input);
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
        await pushSnapshotToDb(snapshot);
      },

      deleteEvent: async (eventId) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.events.delete(eventId);
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
        await pushSnapshotToDb(snapshot);
      },

      deleteTimeline: async (timelineId) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.timelines.delete(timelineId);
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
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
      },

      setCursor: async (cursorIso) => {
        const { currentNovel } = get();
        if (!currentNovel || !cursorIso) {
          set({ selectedCursor: cursorIso, overlappingEvents: [] });
          return;
        }

        const overlaps = await window.novelic.events.getOverlapping(currentNovel.id, cursorIso);
        set({ selectedCursor: cursorIso, overlappingEvents: overlaps });
      },

      setSearchQuery: (query) => set({ searchQuery: query }),

      undo: async () => {
        const { undo_index, undo_history, currentNovel } = get();
        if (!currentNovel || undo_index <= 0) return;

        const nextIndex = undo_index - 1;
        const snapshot = undo_history[nextIndex];
        const payload: NovelPayload = {
          novel: snapshot.novel,
          timelines: snapshot.timelines,
          events: snapshot.events
        };

        await window.novelic.state.replacePayload(payload);
        set({
          currentNovel: payload.novel,
          timelines: payload.timelines,
          events: payload.events,
          undo_index: nextIndex
        });
      },

      redo: async () => {
        const { undo_index, undo_history, currentNovel } = get();
        if (!currentNovel || undo_index >= undo_history.length - 1) return;

        const nextIndex = undo_index + 1;
        const snapshot = undo_history[nextIndex];
        const payload: NovelPayload = {
          novel: snapshot.novel,
          timelines: snapshot.timelines,
          events: snapshot.events
        };

        await window.novelic.state.replacePayload(payload);

        set({
          currentNovel: payload.novel,
          timelines: payload.timelines,
          events: payload.events,
          undo_index: nextIndex
        });
      },

      exportNovelJson: async () => {
        const novel = get().currentNovel;
        if (!novel) return;
        await window.novelic.state.exportNovelJson(novel.id);
      },

      exportTimelineCsv: async (timelineId) => {
        const novel = get().currentNovel;
        if (!novel) return;
        await window.novelic.state.exportTimelineCsv(novel.id, timelineId);
      },

      importNovelJson: async () => {
        const result = await window.novelic.state.importNovelJson();
        if (result?.canceled || !result?.novelId) return;
        const novels = await window.novelic.novels.list();
        set({ novels });
        await get().selectNovel(result.novelId);
      },

      addTimePoint: (label, position, timelineId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const point: TimePoint = {
          id: uuidv4(),
          label: label.trim(),
          position: Math.max(0, Math.min(1, position)),
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
        const clamped = Math.max(0, Math.min(1, position));
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
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [novelId]: nextConnections
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
      }
    }),
    {
      name: 'novelic-ui-cache',
      partialize: (state) => ({
        currentNovel: state.currentNovel,
        selectedCursor: state.selectedCursor,
        searchQuery: state.searchQuery,
        timePointsByNovel: state.timePointsByNovel,
        timePointConnectionsByNovel: state.timePointConnectionsByNovel
      })
    }
  )
);

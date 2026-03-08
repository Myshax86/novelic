import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Novel, NovelPayload, Timeline } from '../../shared/types';

vi.mock('zustand/middleware', async () => {
  const actual = await vi.importActual<typeof import('zustand/middleware')>('zustand/middleware');
  return {
    ...actual,
    persist: ((stateCreator: unknown) => stateCreator) as typeof actual.persist
  };
});

import { useNovelStore } from './useNovelStore';

function makeTimeline(id: string, name: string, color: string, orderIndex: number): Timeline {
  return {
    id,
    novel_id: 'novel-1',
    name,
    color,
    order_index: orderIndex,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };
}

describe('useNovelStore timeline undo consistency', () => {
  const novel: Novel = {
    id: 'novel-1',
    name: 'Novel',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };

  const t1 = makeTimeline('t1', 'Alpha', '#de5b6d', 0);
  const t2 = makeTimeline('t2', 'Beta', '#0f8698', 1);

  const updateTimelineMock = vi.fn(async (_timeline: Timeline) => ({}));
  const createSnapshotMock = vi.fn(async (_novelId: string, _payload: string) => ({}));

  let currentPayload: NovelPayload = {
    novel,
    timelines: [t1, t2],
    events: []
  };

  beforeEach(() => {
    vi.clearAllMocks();

    currentPayload = {
      novel,
      timelines: [t1, t2],
      events: []
    };

    (window as Window & { novelic: unknown }).novelic = {
      novels: {
        list: vi.fn(async () => [novel]),
        create: vi.fn(async () => novel),
        delete: vi.fn(async () => ({ ok: true })),
        getPayload: vi.fn(async () => currentPayload)
      },
      timelines: {
        list: vi.fn(async () => currentPayload.timelines),
        create: vi.fn(async () => currentPayload.timelines[0]),
        update: updateTimelineMock,
        delete: vi.fn(async () => ({ ok: true }))
      },
      events: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({ ok: true })),
        getOverlapping: vi.fn(async () => [])
      },
      state: {
        createSnapshot: createSnapshotMock,
        listSnapshots: vi.fn(async () => []),
        replacePayload: vi.fn(async () => ({ ok: true })),
        exportNovelJson: vi.fn(async () => ({ canceled: true })),
        exportTimelineCsv: vi.fn(async () => ({ canceled: true })),
        importNovelJson: vi.fn(async () => ({ canceled: true }))
      }
    } as unknown;

    useNovelStore.setState({
      novels: [novel],
      currentNovel: novel,
      lastError: null,
      timelines: [t1, t2],
      events: [],
      selectedCursor: null,
      overlappingEvents: [],
      undo_history: [{ novel, timelines: [t1, t2], events: [] }],
      undo_index: 0,
      searchQuery: ''
    });
  });

  it('appends history and snapshots for timeline rename/color/reorder', async () => {
    currentPayload = {
      novel,
      timelines: [{ ...t1, name: 'Alpha Prime' }, t2],
      events: []
    };
    await useNovelStore.getState().updateTimelineName('t1', 'Alpha Prime');

    let state = useNovelStore.getState();
    expect(state.undo_index).toBe(1);
    expect(state.undo_history).toHaveLength(2);

    currentPayload = {
      novel,
      timelines: [{ ...t1, name: 'Alpha Prime', color: '#123456' }, t2],
      events: []
    };
    await useNovelStore.getState().updateTimelineColor('t1', '#123456');

    state = useNovelStore.getState();
    expect(state.undo_index).toBe(2);
    expect(state.undo_history).toHaveLength(3);

    currentPayload = {
      novel,
      timelines: [
        { ...t2, order_index: 0 },
        { ...t1, name: 'Alpha Prime', color: '#123456', order_index: 1 }
      ],
      events: []
    };
    await useNovelStore.getState().reorderTimelines('t1', 't2', 'after');

    state = useNovelStore.getState();
    expect(state.undo_index).toBe(3);
    expect(state.undo_history).toHaveLength(4);
    expect(state.timelines.map((timeline) => timeline.id)).toEqual(['t2', 't1']);

    expect(updateTimelineMock).toHaveBeenCalledTimes(4);
    expect(createSnapshotMock).toHaveBeenCalledTimes(3);
    expect(state.lastError).toBeNull();
  });

  it('grows vertical timeline extent lazily with tight cap', () => {
    useNovelStore.setState({
      currentNovel: novel,
      timePointsByNovel: {
        [novel.id]: [
          {
            id: 'p1',
            label: 'Start',
            position: 0.1,
            timeline_id: '__main_timeline__'
          }
        ]
      },
      bubbleEventsByNovel: {
        [novel.id]: []
      },
      timelineVerticalMaxByNovel: {
        [novel.id]: 1
      }
    });

    const first = useNovelStore.getState().ensureTimelineVerticalExtent(0.95);
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThanOrEqual(1.95);

    const state = useNovelStore.getState();
    expect(state.timelineVerticalMaxByNovel[novel.id]).toBe(first);
  });
});

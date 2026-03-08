import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chapter, Novel, NovelPayload, Timeline } from '../../shared/types';
import { BASE_MIN_GAP } from './timelineLayout';

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
    chapter_id: 'chapter-1',
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
  const chapter: Chapter = {
    id: 'chapter-1',
    novel_id: 'novel-1',
    name: 'Chapter 1',
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  };

  const updateTimelineMock = vi.fn(async (_timeline: Timeline) => ({}));
  const createSnapshotMock = vi.fn(async (_novelId: string, _payload: string) => ({}));

  let currentPayload: NovelPayload = {
    novel,
    chapters: [chapter],
    timelines: [t1, t2],
    events: []
  };

  beforeEach(() => {
    vi.clearAllMocks();

    currentPayload = {
      novel,
      chapters: [chapter],
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
      chapters: {
        list: vi.fn(async () => [chapter]),
        create: vi.fn(async () => chapter),
        update: vi.fn(async () => chapter),
        delete: vi.fn(async () => ({ ok: true }))
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
      chapters: [chapter],
      currentChapter: chapter,
      lastError: null,
      timelines: [t1, t2],
      events: [],
      selectedCursor: null,
      overlappingEvents: [],
      undo_history: [{ novel, chapters: [chapter], timelines: [t1, t2], events: [], currentChapterId: chapter.id }],
      undo_index: 0,
      searchQuery: ''
    });
  });

  it('appends history and snapshots for timeline rename/color/reorder', async () => {
    currentPayload = {
      novel,
      chapters: [chapter],
      timelines: [{ ...t1, name: 'Alpha Prime' }, t2],
      events: []
    };
    await useNovelStore.getState().updateTimelineName('t1', 'Alpha Prime');

    let state = useNovelStore.getState();
    expect(state.undo_index).toBe(1);
    expect(state.undo_history).toHaveLength(2);

    currentPayload = {
      novel,
      chapters: [chapter],
      timelines: [{ ...t1, name: 'Alpha Prime', color: '#123456' }, t2],
      events: []
    };
    await useNovelStore.getState().updateTimelineColor('t1', '#123456');

    state = useNovelStore.getState();
    expect(state.undo_index).toBe(2);
    expect(state.undo_history).toHaveLength(3);

    currentPayload = {
      novel,
      chapters: [chapter],
      timelines: [
        { ...t2, chapter_id: chapter.id, order_index: 0 },
        { ...t1, chapter_id: chapter.id, name: 'Alpha Prime', color: '#123456', order_index: 1 }
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
    const layoutScope = `${novel.id}::${chapter.id}`;
    useNovelStore.setState({
      currentNovel: novel,
      currentChapter: chapter,
      timePointsByNovel: {
        [layoutScope]: [
          {
            id: 'p1',
            label: 'Start',
            position: 0.1,
            timeline_id: '__main_timeline__'
          }
        ]
      },
      bubbleEventsByNovel: {
        [layoutScope]: []
      },
      timelineVerticalMaxByNovel: {
        [layoutScope]: 1
      }
    });

    const first = useNovelStore.getState().ensureTimelineVerticalExtent(0.95);
    expect(first).toBeGreaterThan(1);
    expect(first).toBeLessThanOrEqual(1.95);

    const state = useNovelStore.getState();
    expect(state.timelineVerticalMaxByNovel[layoutScope]).toBe(first);
  });

  it('moves linked events by delta without collapsing their spacing', () => {
    const layoutScope = `${novel.id}::${chapter.id}`;
    useNovelStore.setState({
      currentNovel: novel,
      currentChapter: chapter,
      timePointsByNovel: {
        [layoutScope]: [
          { id: 'p1', label: 'P1', position: 0.2, timeline_id: 't1' },
          { id: 'p2', label: 'P2', position: 0.4, timeline_id: 't2' }
        ]
      },
      bubbleEventsByNovel: {
        [layoutScope]: [
          { id: 'e1', timeline_id: 't1', anchor_point_id: 'p1', title: 'A', side: 'right', offset: 0 },
          { id: 'e2', timeline_id: 't2', anchor_point_id: 'p2', title: 'B', side: 'right', offset: 0.1 }
        ]
      },
      eventDependenciesByNovel: {
        [layoutScope]: [
          {
            id: 'd1',
            timeline_id: 't1',
            from_event_id: 'e1',
            to_event_id: 'e2'
          }
        ]
      },
      timelineVerticalMaxByNovel: {
        [layoutScope]: 1
      }
    });

    const ok = useNovelStore.getState().moveBubbleEvent('e1', 0.3);
    expect(ok).toBe(true);

    const state = useNovelStore.getState();
    const points = new Map(
      (state.timePointsByNovel[layoutScope] ?? []).map((point) => [point.id, point.position])
    );
    const byId = new Map((state.bubbleEventsByNovel[layoutScope] ?? []).map((event) => [event.id, event]));
    const e1 = byId.get('e1');
    const e2 = byId.get('e2');
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (!e1 || !e2) return;

    const e1Pos = (points.get(e1.anchor_point_id) ?? 0) + e1.offset;
    const e2Pos = (points.get(e2.anchor_point_id) ?? 0) + e2.offset;
    expect(e1Pos).toBeCloseTo(0.3, 5);
    expect(e2Pos).toBeCloseTo(0.6, 5);
    expect(e2Pos - e1Pos).toBeCloseTo(0.3, 5);
  });

  it('does not move same-timeline dependency group together', () => {
    const layoutScope = `${novel.id}::${chapter.id}`;
    useNovelStore.setState({
      currentNovel: novel,
      currentChapter: chapter,
      timePointsByNovel: {
        [layoutScope]: [{ id: 'p1', label: 'P1', position: 0.2, timeline_id: 't1' }]
      },
      bubbleEventsByNovel: {
        [layoutScope]: [
          { id: 'e1', timeline_id: 't1', anchor_point_id: 'p1', title: 'A', side: 'right', offset: 0.1 },
          { id: 'e2', timeline_id: 't1', anchor_point_id: 'p1', title: 'B', side: 'right', offset: 0.35 }
        ]
      },
      eventDependenciesByNovel: {
        [layoutScope]: [
          {
            id: 'd1',
            timeline_id: 't1',
            from_event_id: 'e1',
            to_event_id: 'e2'
          }
        ]
      },
      timelineVerticalMaxByNovel: {
        [layoutScope]: 1
      }
    });

    const ok = useNovelStore.getState().moveBubbleEvent('e1', 0.5);
    expect(ok).toBe(true);

    const state = useNovelStore.getState();
    const points = new Map(
      (state.timePointsByNovel[layoutScope] ?? []).map((point) => [point.id, point.position])
    );
    const byId = new Map((state.bubbleEventsByNovel[layoutScope] ?? []).map((event) => [event.id, event]));
    const e1 = byId.get('e1');
    const e2 = byId.get('e2');
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (!e1 || !e2) return;

    const e1Pos = (points.get(e1.anchor_point_id) ?? 0) + e1.offset;
    const e2Pos = (points.get(e2.anchor_point_id) ?? 0) + e2.offset;
    expect(e1Pos).toBeCloseTo(0.5, 5);
    expect(e2Pos).toBeCloseTo(0.55, 5);
  });

  it('separates previously-collapsed linked events on settle', () => {
    const layoutScope = `${novel.id}::${chapter.id}`;
    useNovelStore.setState({
      currentNovel: novel,
      currentChapter: chapter,
      timePointsByNovel: {
        [layoutScope]: [
          { id: 'p1', label: 'P1', position: 0.2, timeline_id: 't1' },
          { id: 'p2', label: 'P2', position: 0.8, timeline_id: 't1' }
        ]
      },
      bubbleEventsByNovel: {
        [layoutScope]: [
          { id: 'e1', timeline_id: 't1', anchor_point_id: 'p1', title: 'A', side: 'right', offset: 0.3 },
          { id: 'e2', timeline_id: 't1', anchor_point_id: 'p1', title: 'B', side: 'right', offset: 0.3 }
        ]
      },
      eventDependenciesByNovel: {
        [layoutScope]: [
          {
            id: 'd1',
            timeline_id: 't1',
            from_event_id: 'e1',
            to_event_id: 'e2'
          }
        ]
      },
      timelineVerticalMaxByNovel: {
        [layoutScope]: 1
      }
    });

    const ok = useNovelStore.getState().settleBubbleEventPosition('e1');
    expect(ok).toBe(true);

    const state = useNovelStore.getState();
    const points = new Map(
      (state.timePointsByNovel[layoutScope] ?? []).map((point) => [point.id, point.position])
    );
    const byId = new Map((state.bubbleEventsByNovel[layoutScope] ?? []).map((event) => [event.id, event]));
    const e1 = byId.get('e1');
    const e2 = byId.get('e2');
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (!e1 || !e2) return;

    const e1Pos = (points.get(e1.anchor_point_id) ?? 0) + e1.offset;
    const e2Pos = (points.get(e2.anchor_point_id) ?? 0) + e2.offset;
    expect(Math.abs(e1Pos - e2Pos)).toBeGreaterThanOrEqual(BASE_MIN_GAP * 0.9);
  });

  it('separates previously-collapsed non-linked events on settle', () => {
    const layoutScope = `${novel.id}::${chapter.id}`;
    useNovelStore.setState({
      currentNovel: novel,
      currentChapter: chapter,
      timePointsByNovel: {
        [layoutScope]: [{ id: 'p1', label: 'P1', position: 0.3, timeline_id: 't1' }]
      },
      bubbleEventsByNovel: {
        [layoutScope]: [
          { id: 'e1', timeline_id: 't1', anchor_point_id: 'p1', title: 'A', side: 'right', offset: 0.2 },
          { id: 'e2', timeline_id: 't1', anchor_point_id: 'p1', title: 'B', side: 'right', offset: 0.2 }
        ]
      },
      eventDependenciesByNovel: {
        [layoutScope]: []
      },
      timelineVerticalMaxByNovel: {
        [layoutScope]: 1
      }
    });

    const ok = useNovelStore.getState().settleBubbleEventPosition('e1');
    expect(ok).toBe(true);

    const state = useNovelStore.getState();
    const points = new Map(
      (state.timePointsByNovel[layoutScope] ?? []).map((point) => [point.id, point.position])
    );
    const byId = new Map((state.bubbleEventsByNovel[layoutScope] ?? []).map((event) => [event.id, event]));
    const e1 = byId.get('e1');
    const e2 = byId.get('e2');
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (!e1 || !e2) return;

    const e1Pos = (points.get(e1.anchor_point_id) ?? 0) + e1.offset;
    const e2Pos = (points.get(e2.anchor_point_id) ?? 0) + e2.offset;
    expect(Math.abs(e1Pos - e2Pos)).toBeGreaterThanOrEqual(BASE_MIN_GAP * 0.9);
  });

  it('repairs collapsed events on demand', () => {
    const layoutScope = `${novel.id}::${chapter.id}`;
    useNovelStore.setState({
      currentNovel: novel,
      currentChapter: chapter,
      timePointsByNovel: {
        [layoutScope]: [{ id: 'p1', label: 'P1', position: 0.4, timeline_id: 't1' }]
      },
      bubbleEventsByNovel: {
        [layoutScope]: [
          { id: 'e1', timeline_id: 't1', anchor_point_id: 'p1', title: 'A', side: 'right', offset: 0.2 },
          { id: 'e2', timeline_id: 't1', anchor_point_id: 'p1', title: 'B', side: 'right', offset: 0.2 }
        ]
      },
      timelineVerticalMaxByNovel: {
        [layoutScope]: 1
      }
    });

    const changed = useNovelStore.getState().repairCollapsedBubbleEvents();
    expect(changed).toBe(true);

    const state = useNovelStore.getState();
    const points = new Map(
      (state.timePointsByNovel[layoutScope] ?? []).map((point) => [point.id, point.position])
    );
    const byId = new Map((state.bubbleEventsByNovel[layoutScope] ?? []).map((event) => [event.id, event]));
    const e1 = byId.get('e1');
    const e2 = byId.get('e2');
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    if (!e1 || !e2) return;

    const e1Pos = (points.get(e1.anchor_point_id) ?? 0) + e1.offset;
    const e2Pos = (points.get(e2.anchor_point_id) ?? 0) + e2.offset;
    expect(Math.abs(e1Pos - e2Pos)).toBeGreaterThanOrEqual(BASE_MIN_GAP * 0.9);
  });
});

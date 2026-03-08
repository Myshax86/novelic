// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandlers, dbQueries } = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  dbQueries: {
    listNovels: vi.fn(),
    createNovel: vi.fn(),
    deleteNovel: vi.fn(),
    listTimelines: vi.fn(),
    createTimeline: vi.fn(),
    updateTimeline: vi.fn(),
    deleteTimeline: vi.fn(),
    listEvents: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    getOverlappingEvents: vi.fn(),
    replaceNovelPayload: vi.fn(),
    createSnapshot: vi.fn(),
    listSnapshots: vi.fn(),
    getNovelPayload: vi.fn(() => ({
      novel: {
        id: 'n1',
        name: 'Novel',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z'
      },
      timelines: [],
      events: []
    }))
  }
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }
  },
  dialog: {
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] }))
  }
}));

vi.mock('../db/queries', () => ({ dbQueries }));

import { registerEventHandlers } from './eventHandlers';
import { registerNovelHandlers } from './novelHandlers';
import { registerStateHandlers } from './stateHandlers';
import { registerTimelineHandlers } from './timelineHandlers';

function invoke(channel: string, ...args: unknown[]) {
  const handler = ipcHandlers.get(channel);
  if (!handler) {
    throw new Error(`Handler not registered for ${channel}`);
  }
  return handler({}, ...args);
}

describe('IPC input validation', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    vi.clearAllMocks();
    registerNovelHandlers();
    registerTimelineHandlers();
    registerEventHandlers();
    registerStateHandlers();
  });

  it('rejects empty novel name payloads', () => {
    expect(() => invoke('novels:create', { name: '   ' })).toThrow('Invalid novel name');
    expect(dbQueries.createNovel).not.toHaveBeenCalled();
  });

  it('rejects invalid timeline color payloads', () => {
    expect(() =>
      invoke('timelines:create', {
        novel_id: 'n1',
        name: 'Main',
        color: '#12345'
      })
    ).toThrow('Invalid timeline color');
    expect(dbQueries.createTimeline).not.toHaveBeenCalled();
  });

  it('rejects invalid cursor date for overlap query', () => {
    expect(() => invoke('events:getOverlapping', 'n1', 'not-a-date')).toThrow('Invalid cursor date');
    expect(dbQueries.getOverlappingEvents).not.toHaveBeenCalled();
  });

  it('trims values before forwarding valid payloads', () => {
    invoke('novels:create', { name: '  My Novel  ' });
    expect(dbQueries.createNovel).toHaveBeenCalledWith({ name: 'My Novel' });

    invoke('events:create', {
      novel_id: 'n1',
      timeline_id: 't1',
      title: '  Title  ',
      description: '  Desc  ',
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: '2026-01-02T00:00:00.000Z'
    });

    expect(dbQueries.createEvent).toHaveBeenCalledWith({
      novel_id: 'n1',
      timeline_id: 't1',
      title: 'Title',
      description: 'Desc',
      start_date: '2026-01-01T00:00:00.000Z',
      end_date: '2026-01-02T00:00:00.000Z'
    });
  });

  it('rejects replacePayload when event references missing timeline', () => {
    expect(() =>
      invoke('state:replacePayload', {
        novel: {
          id: 'n1',
          name: 'Novel',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z'
        },
        timelines: [
          {
            id: 't1',
            novel_id: 'n1',
            name: 'Main',
            color: '#de5b6d',
            order_index: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z'
          }
        ],
        events: [
          {
            id: 'e1',
            novel_id: 'n1',
            timeline_id: 'missing-timeline',
            title: 'Broken event',
            description: '',
            start_date: '2026-01-01T00:00:00.000Z',
            end_date: '2026-01-02T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z'
          }
        ]
      })
    ).toThrow('Event timeline_id must reference an imported timeline');

    expect(dbQueries.replaceNovelPayload).not.toHaveBeenCalled();
  });
});

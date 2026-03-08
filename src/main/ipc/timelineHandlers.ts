import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';
import type { Timeline } from '../../shared/types';

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertHexColor(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error('Invalid timeline color');
  }
}

export function registerTimelineHandlers(): void {
  ipcMain.handle('timelines:list', (_event, novelId: string) => {
    assertNonEmptyString(novelId, 'novel id');
    return dbQueries.listTimelines(novelId);
  });
  ipcMain.handle('timelines:create', (_event, input: { novel_id: string; chapter_id: string; name: string; color: string }) => {
    assertNonEmptyString(input?.novel_id, 'novel id');
    assertNonEmptyString(input?.chapter_id, 'chapter id');
    assertNonEmptyString(input?.name, 'timeline name');
    assertHexColor(input?.color);
    return dbQueries.createTimeline({
      novel_id: input.novel_id,
      chapter_id: input.chapter_id,
      name: input.name.trim(),
      color: input.color
    });
  });
  ipcMain.handle('timelines:update', (_event, timeline: Timeline) => {
    assertNonEmptyString(timeline?.id, 'timeline id');
    assertNonEmptyString(timeline?.novel_id, 'novel id');
    assertNonEmptyString(timeline?.chapter_id, 'chapter id');
    assertNonEmptyString(timeline?.name, 'timeline name');
    assertHexColor(timeline?.color);
    if (!Number.isInteger(timeline?.order_index) || timeline.order_index < 0) {
      throw new Error('Invalid timeline order index');
    }
    return dbQueries.updateTimeline({ ...timeline, name: timeline.name.trim() });
  });
  ipcMain.handle('timelines:delete', (_event, id: string) => {
    assertNonEmptyString(id, 'timeline id');
    dbQueries.deleteTimeline(id);
    return { ok: true };
  });
}

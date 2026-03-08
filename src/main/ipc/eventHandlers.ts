import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';
import type { CreateEventInput, UpdateEventInput } from '../../shared/types';

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}`);
  }
}

function assertCreateEventInput(input: CreateEventInput): void {
  assertNonEmptyString(input?.novel_id, 'novel id');
  assertNonEmptyString(input?.timeline_id, 'timeline id');
  assertNonEmptyString(input?.title, 'event title');
  assertIsoDate(input?.start_date, 'event start date');
  assertIsoDate(input?.end_date, 'event end date');
}

function assertUpdateEventInput(input: UpdateEventInput): void {
  assertNonEmptyString(input?.id, 'event id');
  if (input.timeline_id != null) assertNonEmptyString(input.timeline_id, 'timeline id');
  if (input.title != null) assertNonEmptyString(input.title, 'event title');
  if (input.start_date != null) assertIsoDate(input.start_date, 'event start date');
  if (input.end_date != null) assertIsoDate(input.end_date, 'event end date');
}

export function registerEventHandlers(): void {
  ipcMain.handle('events:list', (_event, novelId: string) => {
    assertNonEmptyString(novelId, 'novel id');
    return dbQueries.listEvents(novelId);
  });
  ipcMain.handle('events:create', (_event, input: CreateEventInput) => {
    assertCreateEventInput(input);
    return dbQueries.createEvent({
      ...input,
      title: input.title.trim(),
      description: input.description?.trim() ?? ''
    });
  });
  ipcMain.handle('events:update', (_event, input: UpdateEventInput) => {
    assertUpdateEventInput(input);
    return dbQueries.updateEvent({
      ...input,
      title: input.title?.trim(),
      description: input.description?.trim()
    });
  });
  ipcMain.handle('events:delete', (_event, id: string) => {
    assertNonEmptyString(id, 'event id');
    dbQueries.deleteEvent(id);
    return { ok: true };
  });
  ipcMain.handle('events:getOverlapping', (_event, novelId: string, cursorDate: string) => {
    assertNonEmptyString(novelId, 'novel id');
    assertIsoDate(cursorDate, 'cursor date');
    return dbQueries.getOverlappingEvents(novelId, cursorDate);
  });
}

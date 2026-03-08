import { dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import { dbQueries } from '../db/queries';
import type { NovelPayload } from '../../shared/types';

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

function assertHexColor(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error('Invalid timeline color');
  }
}

function assertNovelPayload(payload: unknown): asserts payload is NovelPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload');
  }
  const candidate = payload as NovelPayload;
  if (!candidate.novel?.id || !Array.isArray(candidate.timelines) || !Array.isArray(candidate.events)) {
    throw new Error('Invalid payload shape');
  }

  assertNonEmptyString(candidate.novel.id, 'novel id');
  assertNonEmptyString(candidate.novel.name, 'novel name');
  assertIsoDate(candidate.novel.created_at, 'novel created_at');
  assertIsoDate(candidate.novel.updated_at, 'novel updated_at');

  const timelineIds = new Set<string>();
  candidate.timelines.forEach((timeline) => {
    assertNonEmptyString(timeline.id, 'timeline id');
    if (timelineIds.has(timeline.id)) {
      throw new Error('Duplicate timeline id in payload');
    }
    timelineIds.add(timeline.id);
    if (timeline.novel_id !== candidate.novel.id) {
      throw new Error('Timeline novel_id must match imported novel id');
    }
    assertNonEmptyString(timeline.name, 'timeline name');
    assertHexColor(timeline.color);
    if (!Number.isInteger(timeline.order_index) || timeline.order_index < 0) {
      throw new Error('Invalid timeline order index');
    }
    assertIsoDate(timeline.created_at, 'timeline created_at');
    assertIsoDate(timeline.updated_at, 'timeline updated_at');
  });

  const eventIds = new Set<string>();
  candidate.events.forEach((event) => {
    assertNonEmptyString(event.id, 'event id');
    if (eventIds.has(event.id)) {
      throw new Error('Duplicate event id in payload');
    }
    eventIds.add(event.id);
    if (event.novel_id !== candidate.novel.id) {
      throw new Error('Event novel_id must match imported novel id');
    }
    if (!timelineIds.has(event.timeline_id)) {
      throw new Error('Event timeline_id must reference an imported timeline');
    }
    assertNonEmptyString(event.title, 'event title');
    if (typeof event.description !== 'string') {
      throw new Error('Invalid event description');
    }
    assertIsoDate(event.start_date, 'event start_date');
    assertIsoDate(event.end_date, 'event end_date');
    if (Date.parse(event.start_date) > Date.parse(event.end_date)) {
      throw new Error('Event start_date must not be after end_date');
    }
    assertIsoDate(event.created_at, 'event created_at');
    assertIsoDate(event.updated_at, 'event updated_at');
  });
}

export function registerStateHandlers(): void {
  ipcMain.handle('state:createSnapshot', (_event, novelId: string, payload: string) =>
    dbQueries.createSnapshot(novelId, payload)
  );
  ipcMain.handle('state:listSnapshots', (_event, novelId: string) => dbQueries.listSnapshots(novelId));
  ipcMain.handle('state:replacePayload', (_event, payload: NovelPayload) => {
    assertNovelPayload(payload);
    dbQueries.replaceNovelPayload(payload);
    return { ok: true };
  });

  ipcMain.handle('state:exportNovelJson', async (_event, novelId: string) => {
    const payload = dbQueries.getNovelPayload(novelId);
    const result = await dialog.showSaveDialog({
      title: 'Export Novel JSON',
      defaultPath: `${payload.novel.name}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle('state:exportTimelineCsv', async (_event, novelId: string, timelineId: string) => {
    const events = dbQueries.listEvents(novelId).filter((evt) => evt.timeline_id === timelineId);
    const result = await dialog.showSaveDialog({
      title: 'Export Timeline CSV',
      defaultPath: `timeline-${timelineId}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const header = 'id,title,description,start_date,end_date,timeline_id,novel_id';
    const lines = events.map((evt) => {
      const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
      return [
        escape(evt.id),
        escape(evt.title),
        escape(evt.description),
        escape(evt.start_date),
        escape(evt.end_date),
        escape(evt.timeline_id),
        escape(evt.novel_id)
      ].join(',');
    });

    fs.writeFileSync(result.filePath, [header, ...lines].join('\n'), 'utf8');
    return { canceled: false, path: result.filePath };
  });

  ipcMain.handle('state:importNovelJson', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Novel JSON',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    assertNovelPayload(parsed);
    dbQueries.replaceNovelPayload(parsed);

    return {
      canceled: false,
      novelId: parsed.novel.id,
      timelinesImported: parsed.timelines.length,
      eventsImported: parsed.events.length
    };
  });
}

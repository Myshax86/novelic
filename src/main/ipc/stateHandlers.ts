import { dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import { dbQueries } from '../db/queries';
import type { NovelPayload } from '../../shared/types';

function assertNovelPayload(payload: unknown): asserts payload is NovelPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload');
  }
  const candidate = payload as NovelPayload;
  if (!candidate.novel?.id || !Array.isArray(candidate.timelines) || !Array.isArray(candidate.events)) {
    throw new Error('Invalid payload shape');
  }
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

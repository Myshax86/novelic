import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';
import type { Timeline } from '../../shared/types';

export function registerTimelineHandlers(): void {
  ipcMain.handle('timelines:list', (_event, novelId: string) => dbQueries.listTimelines(novelId));
  ipcMain.handle('timelines:create', (_event, input: { novel_id: string; name: string; color: string }) =>
    dbQueries.createTimeline(input)
  );
  ipcMain.handle('timelines:update', (_event, timeline: Timeline) => dbQueries.updateTimeline(timeline));
  ipcMain.handle('timelines:delete', (_event, id: string) => {
    dbQueries.deleteTimeline(id);
    return { ok: true };
  });
}

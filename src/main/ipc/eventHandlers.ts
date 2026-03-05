import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';
import type { UpdateEventInput } from '../../shared/types';

export function registerEventHandlers(): void {
  ipcMain.handle('events:list', (_event, novelId: string) => dbQueries.listEvents(novelId));
  ipcMain.handle('events:create', (_event, input) => dbQueries.createEvent(input));
  ipcMain.handle('events:update', (_event, input: UpdateEventInput) => dbQueries.updateEvent(input));
  ipcMain.handle('events:delete', (_event, id: string) => {
    dbQueries.deleteEvent(id);
    return { ok: true };
  });
  ipcMain.handle('events:getOverlapping', (_event, novelId: string, cursorDate: string) =>
    dbQueries.getOverlappingEvents(novelId, cursorDate)
  );
}

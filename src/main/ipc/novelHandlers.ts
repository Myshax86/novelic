import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';

export function registerNovelHandlers(): void {
  ipcMain.handle('novels:list', () => dbQueries.listNovels());
  ipcMain.handle('novels:create', (_event, input: { name: string }) => dbQueries.createNovel(input));
  ipcMain.handle('novels:delete', (_event, novelId: string) => {
    dbQueries.deleteNovel(novelId);
    return { ok: true };
  });
  ipcMain.handle('novels:getPayload', (_event, novelId: string) => dbQueries.getNovelPayload(novelId));
}

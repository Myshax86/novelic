import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
}

export function registerNovelHandlers(): void {
  ipcMain.handle('novels:list', () => dbQueries.listNovels());
  ipcMain.handle('novels:create', (_event, input: { name: string }) => {
    assertNonEmptyString(input?.name, 'novel name');
    return dbQueries.createNovel({ name: input.name.trim() });
  });
  ipcMain.handle('novels:delete', (_event, novelId: string) => {
    assertNonEmptyString(novelId, 'novel id');
    dbQueries.deleteNovel(novelId);
    return { ok: true };
  });
  ipcMain.handle('novels:getPayload', (_event, novelId: string) => {
    assertNonEmptyString(novelId, 'novel id');
    return dbQueries.getNovelPayload(novelId);
  });
}

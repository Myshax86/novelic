import { ipcMain } from 'electron';
import { dbQueries } from '../db/queries';
import type { UpdateChapterInput } from '../../shared/types';

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
}

export function registerChapterHandlers(): void {
  ipcMain.handle('chapters:list', (_event, novelId: string) => {
    assertNonEmptyString(novelId, 'novel id');
    return dbQueries.listChapters(novelId);
  });

  ipcMain.handle('chapters:create', (_event, input: { novel_id: string; name: string }) => {
    assertNonEmptyString(input?.novel_id, 'novel id');
    assertNonEmptyString(input?.name, 'chapter name');
    return dbQueries.createChapter({ novel_id: input.novel_id, name: input.name.trim() });
  });

  ipcMain.handle('chapters:update', (_event, input: UpdateChapterInput) => {
    assertNonEmptyString(input?.id, 'chapter id');
    assertNonEmptyString(input?.novel_id, 'novel id');
    assertNonEmptyString(input?.name, 'chapter name');
    return dbQueries.updateChapter({ ...input, name: input.name.trim() });
  });

  ipcMain.handle('chapters:delete', (_event, chapterId: string) => {
    assertNonEmptyString(chapterId, 'chapter id');
    dbQueries.deleteChapter(chapterId);
    return { ok: true };
  });
}

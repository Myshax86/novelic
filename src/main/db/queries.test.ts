// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

const sqlRuns: Array<{ sql: string; args: unknown[] }> = [];

const fakeDb = {
  prepare: (sql: string) => ({
    run: (...args: unknown[]) => {
      sqlRuns.push({ sql, args });
      return {};
    }
  }),
  transaction: (fn: () => void) => () => fn()
};

vi.mock('./instance', () => ({
  getDb: () => fakeDb
}));

import { dbQueries } from './queries';

describe('dbQueries.createSnapshot', () => {
  it('runs retention pruning query with 200 snapshot limit', () => {
    sqlRuns.length = 0;
    const novelId = 'novel-retention-1';

    dbQueries.createSnapshot(novelId, 'payload-1');

    expect(sqlRuns).toHaveLength(2);
    expect(sqlRuns[0].sql).toContain('INSERT INTO snapshots');
    expect(sqlRuns[1].sql).toContain('DELETE FROM snapshots');
    expect(sqlRuns[1].args).toEqual([novelId, novelId, 200]);
  });
});

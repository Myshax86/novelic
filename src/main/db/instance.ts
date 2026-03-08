import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

let db: Database.Database | null = null;

const schemaSql = `
CREATE TABLE IF NOT EXISTS novels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS timelines (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
  FOREIGN KEY(chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  timeline_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
  FOREIGN KEY(timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_timeline_novel ON timelines(novel_id);
CREATE INDEX IF NOT EXISTS idx_chapter_novel ON chapters(novel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chapter_novel_name ON chapters(novel_id, name);
CREATE INDEX IF NOT EXISTS idx_event_novel ON events(novel_id);
CREATE INDEX IF NOT EXISTS idx_event_timeline ON events(timeline_id);
CREATE INDEX IF NOT EXISTS idx_event_dates ON events(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_snapshot_novel ON snapshots(novel_id, created_at DESC);
`;

function nowIso(): string {
  return new Date().toISOString();
}

function runMigrations(database: Database.Database): void {
  const timelineColumns = database.prepare("PRAGMA table_info('timelines')").all() as Array<{ name: string }>;
  const hasChapterId = timelineColumns.some((column) => column.name === 'chapter_id');
  if (!hasChapterId) {
    database.exec('ALTER TABLE timelines ADD COLUMN chapter_id TEXT');
  }

  database.exec('CREATE INDEX IF NOT EXISTS idx_timeline_chapter ON timelines(chapter_id)');

  const novels = database.prepare('SELECT id FROM novels').all() as Array<{ id: string }>;
  const upsertChapter = database.prepare(
    'INSERT INTO chapters (id, novel_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const firstChapterByNovel = database.prepare(
    'SELECT id FROM chapters WHERE novel_id = ? ORDER BY order_index ASC, created_at ASC LIMIT 1'
  );
  const backfillTimelineChapter = database.prepare(
    "UPDATE timelines SET chapter_id = ? WHERE novel_id = ? AND (chapter_id IS NULL OR chapter_id = '')"
  );

  novels.forEach((novel) => {
    const firstChapter = firstChapterByNovel.get(novel.id) as { id: string } | undefined;
    if (firstChapter) {
      backfillTimelineChapter.run(firstChapter.id, novel.id);
      return;
    }

    const chapterId = `migrated-${novel.id}`;
    const timestamp = nowIso();
    upsertChapter.run(chapterId, novel.id, 'Chapter 1', 0, timestamp, timestamp);
    backfillTimelineChapter.run(chapterId, novel.id);
  });
}

export function getDbPath(): string {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'novelic.sqlite3');
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  runMigrations(db);

  return db;
}

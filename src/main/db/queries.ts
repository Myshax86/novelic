import { randomUUID } from 'node:crypto';
import { getDb } from './instance';
import type {
  Chapter,
  CreateChapterInput,
  CreateEventInput,
  CreateNovelInput,
  CreateTimelineInput,
  Novel,
  NovelPayload,
  Snapshot,
  Timeline,
  TimelineEvent,
  UpdateChapterInput,
  UpdateEventInput
} from '../../shared/types';

const nowIso = () => new Date().toISOString();
const SNAPSHOT_RETENTION_LIMIT = 200;

export const dbQueries = {
  listNovels(): Novel[] {
    const db = getDb();
    return db.prepare('SELECT * FROM novels ORDER BY updated_at DESC').all() as Novel[];
  },

  createNovel(input: CreateNovelInput): Novel {
    const db = getDb();
    const novel: Novel = {
      id: randomUUID(),
      name: input.name,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    const tx = db.transaction(() => {
      db.prepare(
        'INSERT INTO novels (id, name, created_at, updated_at) VALUES (@id, @name, @created_at, @updated_at)'
      ).run(novel);
      const chapterTimestamp = nowIso();
      db.prepare(
        'INSERT INTO chapters (id, novel_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(randomUUID(), novel.id, 'Chapter 1', 0, chapterTimestamp, chapterTimestamp);
    });
    tx();
    return novel;
  },

  deleteNovel(novelId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM novels WHERE id = ?').run(novelId);
  },

  listChapters(novelId: string): Chapter[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM chapters WHERE novel_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(novelId) as Chapter[];
  },

  createChapter(input: CreateChapterInput): Chapter {
    const db = getDb();
    const maxOrder =
      (
        db.prepare('SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM chapters WHERE novel_id = ?').get(
          input.novel_id
        ) as { maxOrder: number }
      ).maxOrder + 1;
    const chapter: Chapter = {
      id: randomUUID(),
      novel_id: input.novel_id,
      name: input.name,
      order_index: maxOrder,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    try {
      db.prepare(
        'INSERT INTO chapters (id, novel_id, name, order_index, created_at, updated_at) VALUES (@id, @novel_id, @name, @order_index, @created_at, @updated_at)'
      ).run(chapter);
    } catch {
      throw new Error('Chapter name must be unique within a novel');
    }
    return chapter;
  },

  updateChapter(input: UpdateChapterInput): Chapter {
    const db = getDb();
    const current = db.prepare('SELECT * FROM chapters WHERE id = ?').get(input.id) as Chapter | undefined;
    if (!current) {
      throw new Error('Chapter not found');
    }
    const updated: Chapter = {
      ...current,
      name: input.name,
      updated_at: nowIso()
    };
    try {
      db.prepare('UPDATE chapters SET name = @name, updated_at = @updated_at WHERE id = @id').run(updated);
    } catch {
      throw new Error('Chapter name must be unique within a novel');
    }
    return updated;
  },

  deleteChapter(chapterId: string): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM timelines WHERE chapter_id = ?').run(chapterId);
      db.prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
    });
    tx();
  },

  listTimelines(novelId: string, chapterId?: string): Timeline[] {
    const db = getDb();
    if (chapterId) {
      return db
        .prepare(
          'SELECT * FROM timelines WHERE novel_id = ? AND chapter_id = ? ORDER BY order_index ASC, created_at ASC'
        )
        .all(novelId, chapterId) as Timeline[];
    }
    return db
      .prepare('SELECT * FROM timelines WHERE novel_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(novelId) as Timeline[];
  },

  createTimeline(input: CreateTimelineInput): Timeline {
    const db = getDb();
    const maxOrder =
      (
        db.prepare('SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM timelines WHERE chapter_id = ?').get(
          input.chapter_id
        ) as { maxOrder: number }
      ).maxOrder + 1;
    const timeline: Timeline = {
      id: randomUUID(),
      novel_id: input.novel_id,
      chapter_id: input.chapter_id,
      name: input.name,
      color: input.color,
      order_index: maxOrder,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    db.prepare(
      'INSERT INTO timelines (id, novel_id, chapter_id, name, color, order_index, created_at, updated_at) VALUES (@id, @novel_id, @chapter_id, @name, @color, @order_index, @created_at, @updated_at)'
    ).run(timeline);
    return timeline;
  },

  updateTimeline(timeline: Timeline): Timeline {
    const db = getDb();
    const updated = { ...timeline, updated_at: nowIso() };
    db.prepare(
      'UPDATE timelines SET chapter_id = @chapter_id, name = @name, color = @color, order_index = @order_index, updated_at = @updated_at WHERE id = @id'
    ).run(updated);
    return updated;
  },

  deleteTimeline(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM timelines WHERE id = ?').run(id);
  },

  listEvents(novelId: string): TimelineEvent[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM events WHERE novel_id = ? ORDER BY start_date ASC, end_date ASC')
      .all(novelId) as TimelineEvent[];
  },

  listEventsByChapter(novelId: string, chapterId: string): TimelineEvent[] {
    const db = getDb();
    return db
      .prepare(
        `SELECT e.*
         FROM events e
         JOIN timelines t ON t.id = e.timeline_id
         WHERE e.novel_id = ? AND t.chapter_id = ?
         ORDER BY e.start_date ASC, e.end_date ASC`
      )
      .all(novelId, chapterId) as TimelineEvent[];
  },

  createEvent(input: CreateEventInput): TimelineEvent {
    const db = getDb();
    const timeline = db
      .prepare('SELECT id, novel_id FROM timelines WHERE id = ?')
      .get(input.timeline_id) as Pick<Timeline, 'id' | 'novel_id'> | undefined;
    if (!timeline || timeline.novel_id !== input.novel_id) {
      throw new Error('Timeline does not belong to novel');
    }

    const event: TimelineEvent = {
      id: randomUUID(),
      novel_id: input.novel_id,
      timeline_id: input.timeline_id,
      title: input.title,
      description: input.description ?? '',
      start_date: input.start_date,
      end_date: input.end_date,
      created_at: nowIso(),
      updated_at: nowIso()
    };

    db.prepare(
      'INSERT INTO events (id, novel_id, timeline_id, title, description, start_date, end_date, created_at, updated_at) VALUES (@id, @novel_id, @timeline_id, @title, @description, @start_date, @end_date, @created_at, @updated_at)'
    ).run(event);
    return event;
  },

  updateEvent(input: UpdateEventInput): TimelineEvent {
    const db = getDb();
    const current = db.prepare('SELECT * FROM events WHERE id = ?').get(input.id) as TimelineEvent | undefined;
    if (!current) {
      throw new Error('Event not found');
    }

    const updated: TimelineEvent = {
      ...current,
      ...input,
      updated_at: nowIso()
    };

    if (input.timeline_id) {
      const nextTimeline = db
        .prepare('SELECT id, novel_id FROM timelines WHERE id = ?')
        .get(input.timeline_id) as Pick<Timeline, 'id' | 'novel_id'> | undefined;
      if (!nextTimeline || nextTimeline.novel_id !== current.novel_id) {
        throw new Error('Timeline does not belong to novel');
      }
    }

    db.prepare(
      'UPDATE events SET timeline_id = @timeline_id, title = @title, description = @description, start_date = @start_date, end_date = @end_date, updated_at = @updated_at WHERE id = @id'
    ).run(updated);

    return updated;
  },

  deleteEvent(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
  },

  getOverlappingEvents(novelId: string, cursorDate: string, chapterId?: string): TimelineEvent[] {
    const db = getDb();
    if (chapterId) {
      return db
        .prepare(
          `SELECT e.*
           FROM events e
           JOIN timelines t ON t.id = e.timeline_id
           WHERE e.novel_id = ?
             AND t.chapter_id = ?
             AND e.start_date <= ?
             AND e.end_date >= ?
           ORDER BY e.start_date ASC`
        )
        .all(novelId, chapterId, cursorDate, cursorDate) as TimelineEvent[];
    }
    return db
      .prepare(
        'SELECT * FROM events WHERE novel_id = ? AND start_date <= ? AND end_date >= ? ORDER BY start_date ASC'
      )
      .all(novelId, cursorDate, cursorDate) as TimelineEvent[];
  },

  createSnapshot(novelId: string, payload: string): Snapshot {
    const db = getDb();
    const snapshot: Snapshot = {
      id: randomUUID(),
      novel_id: novelId,
      payload,
      created_at: nowIso()
    };

    const tx = db.transaction(() => {
      db.prepare('INSERT INTO snapshots (id, novel_id, payload, created_at) VALUES (@id, @novel_id, @payload, @created_at)').run(snapshot);

      // Keep snapshot history bounded per novel to avoid unbounded DB growth.
      db.prepare(
        `DELETE FROM snapshots
         WHERE novel_id = ?
           AND id NOT IN (
             SELECT id
             FROM snapshots
             WHERE novel_id = ?
             ORDER BY created_at DESC
             LIMIT ?
           )`
      ).run(novelId, novelId, SNAPSHOT_RETENTION_LIMIT);
    });

    tx();
    return snapshot;
  },

  listSnapshots(novelId: string, limit = 50): Snapshot[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM snapshots WHERE novel_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(novelId, limit) as Snapshot[];
  },

  getNovelPayload(novelId: string): NovelPayload {
    const db = getDb();
    const novel = db.prepare('SELECT * FROM novels WHERE id = ?').get(novelId) as Novel | undefined;
    if (!novel) {
      throw new Error('Novel not found');
    }
    return {
      novel,
      chapters: this.listChapters(novelId),
      timelines: this.listTimelines(novelId),
      events: this.listEvents(novelId)
    };
  },

  replaceNovelPayload(payload: NovelPayload): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('INSERT OR REPLACE INTO novels (id, name, created_at, updated_at) VALUES (@id, @name, @created_at, @updated_at)').run(payload.novel);
      db.prepare('DELETE FROM chapters WHERE novel_id = ?').run(payload.novel.id);
      db.prepare('DELETE FROM timelines WHERE novel_id = ?').run(payload.novel.id);
      db.prepare('DELETE FROM events WHERE novel_id = ?').run(payload.novel.id);

      const chapters = payload.chapters.length
        ? payload.chapters
        : [
            {
              id: randomUUID(),
              novel_id: payload.novel.id,
              name: 'Chapter 1',
              order_index: 0,
              created_at: nowIso(),
              updated_at: nowIso()
            }
          ];

      const chapterInsert = db.prepare(
        'INSERT INTO chapters (id, novel_id, name, order_index, created_at, updated_at) VALUES (@id, @novel_id, @name, @order_index, @created_at, @updated_at)'
      );
      const timelineInsert = db.prepare(
        'INSERT INTO timelines (id, novel_id, chapter_id, name, color, order_index, created_at, updated_at) VALUES (@id, @novel_id, @chapter_id, @name, @color, @order_index, @created_at, @updated_at)'
      );
      const eventInsert = db.prepare(
        'INSERT INTO events (id, novel_id, timeline_id, title, description, start_date, end_date, created_at, updated_at) VALUES (@id, @novel_id, @timeline_id, @title, @description, @start_date, @end_date, @created_at, @updated_at)'
      );

      chapters.forEach((chapter) => chapterInsert.run(chapter));

      const fallbackChapterId = chapters[0].id;
      payload.timelines.forEach((timeline) =>
        timelineInsert.run({
          ...timeline,
          chapter_id: timeline.chapter_id || fallbackChapterId
        })
      );
      payload.events.forEach((event) => eventInsert.run(event));
    });

    tx();
  }
};

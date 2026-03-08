import { randomUUID } from 'node:crypto';
import { getDb } from './instance';
import type {
  CreateEventInput,
  CreateNovelInput,
  CreateTimelineInput,
  Novel,
  NovelPayload,
  Snapshot,
  Timeline,
  TimelineEvent,
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
    db.prepare(
      'INSERT INTO novels (id, name, created_at, updated_at) VALUES (@id, @name, @created_at, @updated_at)'
    ).run(novel);
    return novel;
  },

  deleteNovel(novelId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM novels WHERE id = ?').run(novelId);
  },

  listTimelines(novelId: string): Timeline[] {
    const db = getDb();
    return db
      .prepare('SELECT * FROM timelines WHERE novel_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(novelId) as Timeline[];
  },

  createTimeline(input: CreateTimelineInput): Timeline {
    const db = getDb();
    const maxOrder =
      (db.prepare('SELECT COALESCE(MAX(order_index), -1) as maxOrder FROM timelines WHERE novel_id = ?').get(
        input.novel_id
      ) as { maxOrder: number }).maxOrder + 1;
    const timeline: Timeline = {
      id: randomUUID(),
      novel_id: input.novel_id,
      name: input.name,
      color: input.color,
      order_index: maxOrder,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    db.prepare(
      'INSERT INTO timelines (id, novel_id, name, color, order_index, created_at, updated_at) VALUES (@id, @novel_id, @name, @color, @order_index, @created_at, @updated_at)'
    ).run(timeline);
    return timeline;
  },

  updateTimeline(timeline: Timeline): Timeline {
    const db = getDb();
    const updated = { ...timeline, updated_at: nowIso() };
    db.prepare(
      'UPDATE timelines SET name = @name, color = @color, order_index = @order_index, updated_at = @updated_at WHERE id = @id'
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

  createEvent(input: CreateEventInput): TimelineEvent {
    const db = getDb();
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

    db.prepare(
      'UPDATE events SET timeline_id = @timeline_id, title = @title, description = @description, start_date = @start_date, end_date = @end_date, updated_at = @updated_at WHERE id = @id'
    ).run(updated);

    return updated;
  },

  deleteEvent(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM events WHERE id = ?').run(id);
  },

  getOverlappingEvents(novelId: string, cursorDate: string): TimelineEvent[] {
    const db = getDb();
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
      timelines: this.listTimelines(novelId),
      events: this.listEvents(novelId)
    };
  },

  replaceNovelPayload(payload: NovelPayload): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('INSERT OR REPLACE INTO novels (id, name, created_at, updated_at) VALUES (@id, @name, @created_at, @updated_at)').run(payload.novel);
      db.prepare('DELETE FROM timelines WHERE novel_id = ?').run(payload.novel.id);
      db.prepare('DELETE FROM events WHERE novel_id = ?').run(payload.novel.id);

      const timelineInsert = db.prepare(
        'INSERT INTO timelines (id, novel_id, name, color, order_index, created_at, updated_at) VALUES (@id, @novel_id, @name, @color, @order_index, @created_at, @updated_at)'
      );
      const eventInsert = db.prepare(
        'INSERT INTO events (id, novel_id, timeline_id, title, description, start_date, end_date, created_at, updated_at) VALUES (@id, @novel_id, @timeline_id, @title, @description, @start_date, @end_date, @created_at, @updated_at)'
      );

      payload.timelines.forEach((timeline) => timelineInsert.run(timeline));
      payload.events.forEach((event) => eventInsert.run(event));
    });

    tx();
  }
};

export interface Novel {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Chapter {
  id: string;
  novel_id: string;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface Timeline {
  id: string;
  novel_id: string;
  chapter_id: string;
  name: string;
  color: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: string;
  novel_id: string;
  timeline_id: string;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  id: string;
  novel_id: string;
  payload: string;
  created_at: string;
}

export interface NovelPayload {
  novel: Novel;
  chapters: Chapter[];
  timelines: Timeline[];
  events: TimelineEvent[];
}

export interface CreateNovelInput {
  name: string;
}

export interface CreateTimelineInput {
  novel_id: string;
  chapter_id: string;
  name: string;
  color: string;
}

export interface CreateChapterInput {
  novel_id: string;
  name: string;
}

export interface UpdateChapterInput {
  id: string;
  novel_id: string;
  name: string;
}

export interface CreateEventInput {
  novel_id: string;
  timeline_id: string;
  title: string;
  description?: string;
  start_date: string;
  end_date: string;
}

export interface UpdateEventInput {
  id: string;
  title?: string;
  description?: string;
  timeline_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface OverlapQueryInput {
  novel_id: string;
  cursor_date: string;
}

export interface ImportResult {
  novelId: string;
  timelinesImported: number;
  eventsImported: number;
}

import type {
  CreateEventInput,
  CreateNovelInput,
  CreateTimelineInput,
  Novel,
  NovelPayload,
  Timeline,
  TimelineEvent,
  UpdateEventInput
} from '../../shared/types';

export const novelApi = {
  listNovels: (): Promise<Novel[]> => window.novelic.novels.list(),
  createNovel: (input: CreateNovelInput): Promise<Novel> => window.novelic.novels.create(input),
  getNovelPayload: (novelId: string): Promise<NovelPayload> => window.novelic.novels.getPayload(novelId),

  createTimeline: (input: CreateTimelineInput): Promise<Timeline> => window.novelic.timelines.create(input),
  updateTimeline: (timeline: Timeline): Promise<Timeline> => window.novelic.timelines.update(timeline),
  deleteTimeline: (timelineId: string): Promise<{ ok: boolean }> => window.novelic.timelines.delete(timelineId),

  createEvent: (input: CreateEventInput): Promise<TimelineEvent> => window.novelic.events.create(input),
  updateEvent: (input: UpdateEventInput): Promise<TimelineEvent> => window.novelic.events.update(input),
  deleteEvent: (eventId: string): Promise<{ ok: boolean }> => window.novelic.events.delete(eventId),
  getOverlappingEvents: (novelId: string, cursorIso: string): Promise<TimelineEvent[]> =>
    window.novelic.events.getOverlapping(novelId, cursorIso),

  createSnapshot: (novelId: string, payload: string) => window.novelic.state.createSnapshot(novelId, payload),
  replacePayload: (payload: NovelPayload): Promise<{ ok: boolean }> => window.novelic.state.replacePayload(payload),
  exportNovelJson: (novelId: string) => window.novelic.state.exportNovelJson(novelId),
  exportTimelineCsv: (novelId: string, timelineId: string) =>
    window.novelic.state.exportTimelineCsv(novelId, timelineId),
  importNovelJson: () => window.novelic.state.importNovelJson()
};

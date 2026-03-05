import { useNovelStore } from '../store/useNovelStore';

export async function exportCurrentNovelAsJson() {
  await useNovelStore.getState().exportNovelJson();
}

export async function exportTimelineAsCsv(timelineId: string) {
  await useNovelStore.getState().exportTimelineCsv(timelineId);
}

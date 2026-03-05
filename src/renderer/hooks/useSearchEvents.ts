import { useMemo } from 'react';
import { useNovelStore } from '../store/useNovelStore';

function scoreQuery(target: string, query: string): number {
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return q.length + 100;

  let qi = 0;
  let score = 0;
  for (let i = 0; i < t.length && qi < q.length; i += 1) {
    if (t[i] === q[qi]) {
      qi += 1;
      score += 2;
    }
  }

  return qi === q.length ? score : 0;
}

export function useSearchEvents() {
  const query = useNovelStore((s) => s.searchQuery);
  const events = useNovelStore((s) => s.events);
  const timelines = useNovelStore((s) => s.timelines);

  return useMemo(() => {
    if (!query.trim()) return events;

    const timelineById = new Map(timelines.map((timeline) => [timeline.id, timeline.name]));

    return events
      .map((event) => {
        const timelineName = timelineById.get(event.timeline_id) ?? '';
        const body = `${event.title} ${event.description} ${timelineName}`;
        return {
          event,
          score: scoreQuery(body, query)
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.event);
  }, [events, query, timelines]);
}

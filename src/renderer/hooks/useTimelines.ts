import { useMemo } from 'react';
import { useNovelStore } from '../store/useNovelStore';

export function useTimelines() {
  const timelines = useNovelStore((s) => s.timelines);
  return useMemo(() => timelines, [timelines]);
}

import { useMemo } from 'react';
import { useNovelStore } from '../store/useNovelStore';

export function useEvents() {
  const events = useNovelStore((s) => s.events);
  return useMemo(() => events, [events]);
}

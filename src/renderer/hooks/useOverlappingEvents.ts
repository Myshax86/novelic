import { useMemo } from 'react';
import { useNovelStore } from '../store/useNovelStore';

export function useOverlappingEvents() {
  const selectedCursor = useNovelStore((s) => s.selectedCursor);
  const overlappingEvents = useNovelStore((s) => s.overlappingEvents);

  return useMemo(
    () => ({
      selectedCursor,
      overlappingEvents
    }),
    [selectedCursor, overlappingEvents]
  );
}

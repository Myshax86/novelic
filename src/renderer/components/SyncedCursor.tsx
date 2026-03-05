import { useMemo } from 'react';
import { useOverlappingEvents } from '../hooks/useOverlappingEvents';
import { useNovelStore } from '../store/useNovelStore';

export function SyncedCursor() {
  const { selectedCursor, overlappingEvents } = useOverlappingEvents();
  const timelines = useNovelStore((s) => s.timelines);

  const timelineMap = useMemo(() => new Map(timelines.map((timeline) => [timeline.id, timeline])), [timelines]);

  return (
    <section className="panel cursor-panel">
      <h2>Synced Cursor</h2>
      <p>{selectedCursor ? `Cursor: ${new Date(selectedCursor).toLocaleString()}` : 'Move the pointer over timeline view.'}</p>
      <h3>Overlapping events ({overlappingEvents.length})</h3>
      <div className="overlap-list">
        {overlappingEvents.length === 0 && <p className="muted">No overlaps at current cursor.</p>}
        {overlappingEvents.map((event) => {
          const timeline = timelineMap.get(event.timeline_id);
          return (
            <article key={event.id} className="overlap-item">
              <span className="color-dot" style={{ backgroundColor: timeline?.color ?? '#999' }} />
              <div>
                <strong>{event.title}</strong>
                <p>{timeline?.name ?? 'Unknown timeline'}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

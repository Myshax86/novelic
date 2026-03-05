import { useEffect, useMemo, useState } from 'react';
import type { TimelineEvent } from '../../shared/types';
import { useNovelStore } from '../store/useNovelStore';

interface EventFormProps {
  open: boolean;
  event: TimelineEvent | null;
  defaultTimelineId?: string;
  defaultYear?: number;
  onClose: () => void;
}

function startIsoForYear(year: number): string {
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).toISOString();
}

function endIsoForYear(year: number): string {
  return new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString();
}

export function EventForm({ open, event, defaultTimelineId, defaultYear, onClose }: EventFormProps) {
  const timelines = useNovelStore((s) => s.timelines);
  const createEvent = useNovelStore((s) => s.createEvent);
  const updateEvent = useNovelStore((s) => s.updateEvent);

  const fallbackTimelineId = useMemo(() => defaultTimelineId ?? timelines[0]?.id ?? '', [defaultTimelineId, timelines]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [timelineId, setTimelineId] = useState(fallbackTimelineId);
  const [startYear, setStartYear] = useState('');
  const [endYear, setEndYear] = useState('');

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setDescription(event.description);
      setTimelineId(event.timeline_id);
      setStartYear(String(new Date(event.start_date).getUTCFullYear()));
      setEndYear(String(new Date(event.end_date).getUTCFullYear()));
      return;
    }

    const baseYear = defaultYear ?? new Date().getUTCFullYear();
    setTitle('');
    setDescription('');
    setTimelineId(fallbackTimelineId);
    setStartYear(String(baseYear));
    setEndYear(String(baseYear));
  }, [defaultYear, event, fallbackTimelineId, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3>{event ? 'Edit Event' : 'Create Event'}</h3>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </label>
        <label>
          Timeline
          <select value={timelineId} onChange={(e) => setTimelineId(e.target.value)}>
            {timelines.map((timeline) => (
              <option key={timeline.id} value={timeline.id}>
                {timeline.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start Year
          <input type="number" value={startYear} onChange={(e) => setStartYear(e.target.value)} />
        </label>
        <label>
          End Year
          <input type="number" value={endYear} onChange={(e) => setEndYear(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button
            onClick={async () => {
              const parsedStart = Number(startYear);
              const parsedEnd = Number(endYear);
              if (!title.trim() || !timelineId || !Number.isInteger(parsedStart) || !Number.isInteger(parsedEnd)) return;
              const normalizedStart = Math.min(parsedStart, parsedEnd);
              const normalizedEnd = Math.max(parsedStart, parsedEnd);
              if (event) {
                await updateEvent({
                  id: event.id,
                  title: title.trim(),
                  description,
                  timeline_id: timelineId,
                  start_date: startIsoForYear(normalizedStart),
                  end_date: endIsoForYear(normalizedEnd)
                });
              } else {
                await createEvent({
                  title: title.trim(),
                  description,
                  timeline_id: timelineId,
                  start_date: startIsoForYear(normalizedStart),
                  end_date: endIsoForYear(normalizedEnd)
                });
              }
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

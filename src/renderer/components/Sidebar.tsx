import { useState } from 'react';
import { useNovelStore } from '../store/useNovelStore';

const palette = ['#de5b6d', '#0f8698', '#f08f2e', '#6f64e7', '#44aa72', '#f3ca40'];

export function Sidebar() {
  const currentNovel = useNovelStore((s) => s.currentNovel);
  const timelines = useNovelStore((s) => s.timelines);
  const setSearchQuery = useNovelStore((s) => s.setSearchQuery);
  const searchQuery = useNovelStore((s) => s.searchQuery);
  const createTimeline = useNovelStore((s) => s.createTimeline);
  const updateTimelineName = useNovelStore((s) => s.updateTimelineName);
  const updateTimelineColor = useNovelStore((s) => s.updateTimelineColor);
  const deleteTimeline = useNovelStore((s) => s.deleteTimeline);
  const undo = useNovelStore((s) => s.undo);
  const redo = useNovelStore((s) => s.redo);
  const exportNovelJson = useNovelStore((s) => s.exportNovelJson);
  const exportTimelineCsv = useNovelStore((s) => s.exportTimelineCsv);
  const importNovelJson = useNovelStore((s) => s.importNovelJson);

  const [timelineName, setTimelineName] = useState('');
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null);
  const [editingTimelineName, setEditingTimelineName] = useState('');

  return (
    <aside className="panel sidebar-panel">
      <h2>Tools</h2>
      <input
        placeholder="Search events"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <div className="button-grid">
        <button onClick={undo}>Undo</button>
        <button onClick={redo}>Redo</button>
        <button onClick={exportNovelJson} disabled={!currentNovel}>
          Export JSON
        </button>
        <button onClick={importNovelJson}>Import JSON</button>
      </div>

      <h3>Timelines</h3>
      <div className="selector-row">
        <input
          placeholder="Timeline name"
          value={timelineName}
          onChange={(e) => setTimelineName(e.target.value)}
        />
        <button
          onClick={async () => {
            if (!timelineName.trim()) return;
            const color = palette[timelines.length % palette.length];
            await createTimeline(timelineName.trim(), color);
            setTimelineName('');
          }}
        >
          Add
        </button>
      </div>

      <div className="timeline-list">
        {timelines.map((timeline) => (
          <div key={timeline.id} className="timeline-item">
            <label className="color-dot-button" style={{ backgroundColor: timeline.color }}>
              <input
                type="color"
                value={timeline.color}
                onChange={(e) => updateTimelineColor(timeline.id, e.target.value)}
                aria-label={`Change color for ${timeline.name}`}
              />
            </label>
            {editingTimelineId === timeline.id ? (
              <input
                value={editingTimelineName}
                onChange={(e) => setEditingTimelineName(e.target.value)}
                onBlur={async () => {
                  await updateTimelineName(timeline.id, editingTimelineName);
                  setEditingTimelineId(null);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await updateTimelineName(timeline.id, editingTimelineName);
                    setEditingTimelineId(null);
                  }
                  if (e.key === 'Escape') {
                    setEditingTimelineId(null);
                  }
                }}
                autoFocus
              />
            ) : (
              <div className="timeline-name-cell">
                <span
                  onDoubleClick={() => {
                    setEditingTimelineId(timeline.id);
                    setEditingTimelineName(timeline.name);
                  }}
                >
                  {timeline.name}
                </span>
                <button
                  className="timeline-edit-button"
                  aria-label={`Edit ${timeline.name}`}
                  onClick={() => {
                    setEditingTimelineId(timeline.id);
                    setEditingTimelineName(timeline.name);
                  }}
                >
                  Edit
                </button>
              </div>
            )}
            <button onClick={() => exportTimelineCsv(timeline.id)}>CSV</button>
            <button onClick={() => deleteTimeline(timeline.id)}>Delete</button>
          </div>
        ))}
      </div>
    </aside>
  );
}

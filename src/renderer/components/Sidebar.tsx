import { useState } from 'react';
import { useNovelStore } from '../store/useNovelStore';

const palette = ['#de5b6d', '#0f8698', '#f08f2e', '#6f64e7', '#44aa72', '#f3ca40'];

export function Sidebar() {
  const currentNovel = useNovelStore((s) => s.currentNovel);
  const chapters = useNovelStore((s) => s.chapters);
  const currentChapter = useNovelStore((s) => s.currentChapter);
  const timelines = useNovelStore((s) => s.timelines);
  const setSearchQuery = useNovelStore((s) => s.setSearchQuery);
  const searchQuery = useNovelStore((s) => s.searchQuery);
  const lastError = useNovelStore((s) => s.lastError);
  const clearError = useNovelStore((s) => s.clearError);
  const createTimeline = useNovelStore((s) => s.createTimeline);
  const selectChapter = useNovelStore((s) => s.selectChapter);
  const createChapter = useNovelStore((s) => s.createChapter);
  const renameChapter = useNovelStore((s) => s.renameChapter);
  const deleteChapter = useNovelStore((s) => s.deleteChapter);
  const updateTimelineName = useNovelStore((s) => s.updateTimelineName);
  const updateTimelineColor = useNovelStore((s) => s.updateTimelineColor);
  const deleteTimeline = useNovelStore((s) => s.deleteTimeline);
  const undo = useNovelStore((s) => s.undo);
  const redo = useNovelStore((s) => s.redo);
  const exportNovelJson = useNovelStore((s) => s.exportNovelJson);
  const exportTimelineCsv = useNovelStore((s) => s.exportTimelineCsv);
  const importNovelJson = useNovelStore((s) => s.importNovelJson);

  const [timelineName, setTimelineName] = useState('');
  const [chapterName, setChapterName] = useState('');
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [editingChapterName, setEditingChapterName] = useState('');
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null);
  const [editingTimelineName, setEditingTimelineName] = useState('');

  return (
    <aside className="panel sidebar-panel">
      <h2>Tools</h2>
      {lastError && (
        <div className="sidebar-error" role="alert">
          <span>{lastError}</span>
          <button type="button" onClick={clearError}>
            Dismiss
          </button>
        </div>
      )}
      <input
        aria-label="Search events"
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

      <h3>Chapters</h3>
      <div className="selector-row">
        <input
          aria-label="Chapter name"
          placeholder="Chapter name"
          value={chapterName}
          onChange={(e) => setChapterName(e.target.value)}
          disabled={!currentNovel}
        />
        <button
          onClick={async () => {
            if (!chapterName.trim()) return;
            await createChapter(chapterName.trim());
            setChapterName('');
          }}
          disabled={!currentNovel}
        >
          Add
        </button>
      </div>

      <div className="timeline-list">
        {chapters.map((chapter) => (
          <div key={chapter.id} className="chapter-item">
            {editingChapterId === chapter.id ? (
              <input
                value={editingChapterName}
                onChange={(e) => setEditingChapterName(e.target.value)}
                onBlur={async () => {
                  await renameChapter(chapter.id, editingChapterName);
                  setEditingChapterId(null);
                }}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await renameChapter(chapter.id, editingChapterName);
                    setEditingChapterId(null);
                  }
                  if (e.key === 'Escape') {
                    setEditingChapterId(null);
                  }
                }}
                autoFocus
              />
            ) : (
              <button
                className="chapter-name-button"
                type="button"
                onClick={() => selectChapter(chapter.id)}
              >
                <span>{currentChapter?.id === chapter.id ? `* ${chapter.name}` : chapter.name}</span>
              </button>
            )}
            <button
              onClick={() => {
                setEditingChapterId(chapter.id);
                setEditingChapterName(chapter.name);
              }}
            >
              Edit
            </button>
            <button
              onClick={async () => {
                const confirmed = window.confirm(
                  'Delete this chapter? This will permanently delete all timelines and events in it.'
                );
                if (!confirmed) return;
                await deleteChapter(chapter.id);
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <h3>Timelines</h3>
      <div className="selector-row">
        <input
          aria-label="Timeline name"
          placeholder="Timeline name"
          value={timelineName}
          onChange={(e) => setTimelineName(e.target.value)}
          disabled={!currentChapter}
        />
        <button
          onClick={async () => {
            if (!timelineName.trim()) return;
            const color = palette[timelines.length % palette.length];
            await createTimeline(timelineName.trim(), color);
            setTimelineName('');
          }}
          disabled={!currentChapter}
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

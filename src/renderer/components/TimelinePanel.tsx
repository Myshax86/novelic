import { useEffect, useMemo, useRef, useState } from 'react';
import { useNovelStore } from '../store/useNovelStore';

const AXIS_HEIGHT = 720;
const MAIN_TIMELINE_ID = '__main_timeline__';
const MAIN_COLUMN_WIDTH = 240;
const ENTITY_COLUMN_WIDTH = 210;
const COLUMN_GAP = 16;

interface AnchorEditor {
  mode: 'create' | 'edit';
  id?: string;
  position: number;
  label: string;
  x: number;
  timelineId: string;
}

interface TimelineContextMenu {
  x: number;
  y: number;
  target: { type: 'point'; id: string } | { type: 'connection'; id: string };
}

const CONTEXT_MENU_WIDTH = 120;
const CONTEXT_MENU_HEIGHT = 44;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function TimelinePanel() {
  const panelRef = useRef<HTMLElement | null>(null);
  const timelines = useNovelStore((s) => s.timelines);
  const currentNovel = useNovelStore((s) => s.currentNovel);
  const timePointsByNovel = useNovelStore((s) => s.timePointsByNovel);
  const timePointConnectionsByNovel = useNovelStore((s) => s.timePointConnectionsByNovel);
  const addTimePoint = useNovelStore((s) => s.addTimePoint);
  const updateTimePoint = useNovelStore((s) => s.updateTimePoint);
  const updateTimePointPosition = useNovelStore((s) => s.updateTimePointPosition);
  const deleteTimePoint = useNovelStore((s) => s.deleteTimePoint);
  const addTimePointConnection = useNovelStore((s) => s.addTimePointConnection);
  const setCursor = useNovelStore((s) => s.setCursor);
  const [editor, setEditor] = useState<AnchorEditor | null>(null);
  const [hoverState, setHoverState] = useState<{ timelineId: string; position: number } | null>(null);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [linkDragFromId, setLinkDragFromId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<TimelineContextMenu | null>(null);

  const rawPoints = useMemo(() => {
    if (!currentNovel) return [];
    return (timePointsByNovel[currentNovel.id] ?? []).slice().sort((a, b) => a.position - b.position);
  }, [currentNovel, timePointsByNovel]);

  const points = useMemo(
    () =>
      rawPoints.map((point) => ({
        ...point,
        timeline_id: point.timeline_id ?? MAIN_TIMELINE_ID
      })),
    [rawPoints]
  );

  const connections = useMemo(() => {
    if (!currentNovel) return [];
    return timePointConnectionsByNovel[currentNovel.id] ?? [];
  }, [currentNovel, timePointConnectionsByNovel]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('pointerdown', close);
    };
  }, []);

  const openContextMenu = (
    x: number,
    y: number,
    target: { type: 'point'; id: string } | { type: 'connection'; id: string }
  ) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const localX = x - rect.left;
    const localY = y - rect.top;
    const clampedX = Math.min(localX, rect.width - CONTEXT_MENU_WIDTH);
    const clampedY = Math.min(localY, rect.height - CONTEXT_MENU_HEIGHT);
    setContextMenu({ x: Math.max(8, clampedX), y: Math.max(8, clampedY), target });
  };

  const columns = useMemo(
    () => [
      { id: MAIN_TIMELINE_ID, name: 'Main Timeline', color: '#d73a49', width: MAIN_COLUMN_WIDTH },
      ...timelines.map((timeline) => ({ id: timeline.id, name: timeline.name, color: timeline.color, width: ENTITY_COLUMN_WIDTH }))
    ],
    [timelines]
  );

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  const columnCenterX = useMemo(() => {
    const map = new Map<string, number>();
    let offset = 0;
    columns.forEach((column, index) => {
      map.set(column.id, offset + column.width / 2);
      offset += column.width;
      if (index < columns.length - 1) offset += COLUMN_GAP;
    });
    return map;
  }, [columns]);

  const contentWidth = useMemo(
    () => columns.reduce((sum, column) => sum + column.width, 0) + Math.max(0, columns.length - 1) * COLUMN_GAP,
    [columns]
  );

  const positionToTop = (position: number) => clamp01(position) * AXIS_HEIGHT;

  const createPointAtClick = (timelineId: string, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const position = clamp01(y / AXIS_HEIGHT);
    const x = event.clientX - rect.left;
    setEditor({ mode: 'create', position, label: '', x, timelineId });
  };

  const saveEditor = () => {
    if (!editor || !editor.label.trim()) return;
    if (editor.mode === 'create') {
      addTimePoint(editor.label.trim(), editor.position, editor.timelineId);
    } else if (editor.id) {
      updateTimePoint(editor.id, editor.label.trim());
    }
    setEditor(null);
  };

  return (
    <section className="panel timeline-panel" ref={panelRef}>
      <h2>Timeline Anchors</h2>
      <p className="muted">Click any timeline to add points. Drag a point handle to another timeline point to connect them.</p>

      <div className="anchor-board">
        <div className="anchor-content" style={{ width: `${contentWidth}px` }}>
          <svg className="connection-layer" width={contentWidth} height={AXIS_HEIGHT}>
            {connections.map((connection) => {
              const from = pointById.get(connection.from_point_id);
              const to = pointById.get(connection.to_point_id);
              if (!from || !to) return null;
              const x1 = columnCenterX.get(from.timeline_id);
              const x2 = columnCenterX.get(to.timeline_id);
              if (x1 == null || x2 == null) return null;
              const y1 = positionToTop(from.position);
              const y2 = positionToTop(to.position);
              return (
                <line
                  key={connection.id}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(31, 41, 51, 0.55)"
                  strokeWidth="2"
                  className="connection-line"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(e.clientX, e.clientY, { type: 'connection', id: connection.id });
                  }}
                />
              );
            })}
          </svg>

          {columns.map((column) => {
            const columnPoints = points.filter((point) => point.timeline_id === column.id);
            const isMain = column.id === MAIN_TIMELINE_ID;
            const showHover = hoverState != null;
            const showDot = hoverState?.timelineId === column.id;
            return (
              <div
                key={column.id}
                className={`timeline-column${isMain ? ' main-column' : ''}`}
                style={{ width: `${column.width}px`, flexBasis: `${column.width}px` }}
              >
                <h3>{column.name}</h3>
                <div
                  className={`timeline-axis ${isMain ? 'main-axis' : 'entity-axis'}`}
                  onClick={(event) => createPointAtClick(column.id, event)}
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const y = event.clientY - rect.top;
                    const nextPosition = clamp01(y / AXIS_HEIGHT);
                    setHoverState({ timelineId: column.id, position: nextPosition });
                    const fakeYear = 1900 + Math.round(nextPosition * 200);
                    setCursor(new Date(Date.UTC(fakeYear, 0, 1)).toISOString());
                  }}
                  onMouseLeave={() => {
                    setHoverState(null);
                    setCursor(null);
                  }}
                >
                  <div className={`timeline-line ${isMain ? 'main-line' : ''}`} style={{ backgroundColor: isMain ? undefined : column.color }} />
                  {showHover && <div className="horizontal-cursor-axis" style={{ top: `${positionToTop(hoverState.position)}px` }} />}
                  {showDot && <div className="main-hover-dot" style={{ top: `${positionToTop(hoverState.position)}px` }} />}

                  {columnPoints.map((point) => (
                    <button
                      key={point.id}
                      className="anchor-point"
                      style={{ top: `${positionToTop(point.position)}px`, background: isMain ? '#d73a49' : column.color }}
                      title={point.label}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const target = e.currentTarget.getBoundingClientRect();
                        const axisRect = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
                        setEditor({
                          mode: 'edit',
                          id: point.id,
                          position: point.position,
                          label: point.label,
                          x: target.left - axisRect.left,
                          timelineId: point.timeline_id
                        });
                      }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setDraggingPointId(point.id);
                        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (draggingPointId !== point.id) return;
                        const axis = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
                        const nextPosition = clamp01((e.clientY - axis.top) / AXIS_HEIGHT);
                        setHoverState({ timelineId: point.timeline_id, position: nextPosition });
                        updateTimePointPosition(point.id, nextPosition);
                      }}
                      onPointerUp={(e) => {
                        if (draggingPointId !== point.id) return;
                        (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
                        setDraggingPointId(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openContextMenu(e.clientX, e.clientY, { type: 'point', id: point.id });
                      }}
                      onDragOver={(e) => {
                        if (linkDragFromId && linkDragFromId !== point.id) {
                          e.preventDefault();
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const fromId = e.dataTransfer.getData('application/x-novelic-point-id') || linkDragFromId;
                        if (!fromId || fromId === point.id) return;
                        addTimePointConnection(fromId, point.id);
                        setLinkDragFromId(null);
                      }}
                    >
                      <span>{point.label}</span>
                      <span
                        className="point-link-handle"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setLinkDragFromId(point.id);
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('application/x-novelic-point-id', point.id);
                        }}
                        onDragEnd={() => setLinkDragFromId(null)}
                        title="Drag to another timeline point to connect"
                      />
                    </button>
                  ))}

                  {editor && editor.timelineId === column.id && (
                    <div
                      className="anchor-editor-inline"
                      style={{ top: `${positionToTop(editor.position)}px`, left: `${Math.max(90, editor.x)}px` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={editor.label}
                        placeholder="Label"
                        onChange={(e) => setEditor((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEditor();
                          if (e.key === 'Escape') setEditor(null);
                        }}
                      />
                      <div className="anchor-editor-actions">
                        <button onClick={() => setEditor(null)}>Cancel</button>
                        <button onClick={saveEditor}>Save</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {contextMenu && (
        <div
          className="timeline-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className="timeline-context-menu-remove"
            onClick={() => {
              if (contextMenu.target.type === 'point') {
                deleteTimePoint(contextMenu.target.id);
              }
              if (contextMenu.target.type === 'connection' && currentNovel) {
                const existing = timePointConnectionsByNovel[currentNovel.id] ?? [];
                const next = existing.filter((item) => item.id !== contextMenu.target.id);
                useNovelStore.setState((state) => ({
                  timePointConnectionsByNovel: {
                    ...state.timePointConnectionsByNovel,
                    [currentNovel.id]: next
                  }
                }));
              }
              setContextMenu(null);
            }}
          >
            Remove
          </button>
        </div>
      )}
    </section>
  );
}

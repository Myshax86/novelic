import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNovelStore } from '../store/useNovelStore';

const AXIS_HEIGHT = 720;
const MAIN_TIMELINE_ID = '__main_timeline__';
const MAIN_COLUMN_WIDTH = 240;
const ENTITY_COLUMN_WIDTH = 210;
const COLUMN_GAP = 16;
const CONTEXT_MENU_WIDTH = 140;
const CONTEXT_MENU_HEIGHT = 44;
const BUBBLE_X_OFFSET = 86;

interface PointEditor {
  mode: 'create' | 'edit';
  id?: string;
  position: number;
  label: string;
  x: number;
  timelineId: string;
}

interface BubbleEditor {
  mode: 'create' | 'edit';
  id?: string;
  position: number;
  title: string;
  x: number;
  timelineId: string;
}

interface TimelineContextMenu {
  x: number;
  y: number;
  target:
    | { type: 'point'; id: string }
    | { type: 'connection'; id: string }
    | { type: 'bubble'; id: string }
    | { type: 'bubble-dependency'; id: string };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function TimelinePanel() {
  const panelRef = useRef<HTMLElement | null>(null);

  const timelines = useNovelStore((s) => s.timelines);
  const currentNovel = useNovelStore((s) => s.currentNovel);
  const timePointsByNovel = useNovelStore((s) => s.timePointsByNovel);
  const timePointConnectionsByNovel = useNovelStore((s) => s.timePointConnectionsByNovel);
  const bubbleEventsByNovel = useNovelStore((s) => s.bubbleEventsByNovel);
  const eventDependenciesByNovel = useNovelStore((s) => s.eventDependenciesByNovel);
  const timelineColumnWidthsByNovel = useNovelStore((s) => s.timelineColumnWidthsByNovel);

  const addTimePoint = useNovelStore((s) => s.addTimePoint);
  const updateTimePoint = useNovelStore((s) => s.updateTimePoint);
  const updateTimePointPosition = useNovelStore((s) => s.updateTimePointPosition);
  const deleteTimePoint = useNovelStore((s) => s.deleteTimePoint);
  const addTimePointConnection = useNovelStore((s) => s.addTimePointConnection);

  const addBubbleEvent = useNovelStore((s) => s.addBubbleEvent);
  const updateBubbleEventTitle = useNovelStore((s) => s.updateBubbleEventTitle);
  const moveBubbleEvent = useNovelStore((s) => s.moveBubbleEvent);
  const settleBubbleEventPosition = useNovelStore((s) => s.settleBubbleEventPosition);
  const deleteBubbleEvent = useNovelStore((s) => s.deleteBubbleEvent);
  const addEventDependency = useNovelStore((s) => s.addEventDependency);
  const deleteEventDependency = useNovelStore((s) => s.deleteEventDependency);
  const setBubbleEventSide = useNovelStore((s) => s.setBubbleEventSide);
  const setTimelineColumnWidth = useNovelStore((s) => s.setTimelineColumnWidth);
  const reorderTimelines = useNovelStore((s) => s.reorderTimelines);

  const setCursor = useNovelStore((s) => s.setCursor);

  const [mode, setMode] = useState<'point' | 'event'>('point');
  const [pointEditor, setPointEditor] = useState<PointEditor | null>(null);
  const [bubbleEditor, setBubbleEditor] = useState<BubbleEditor | null>(null);
  const [hoverState, setHoverState] = useState<{ timelineId: string; position: number } | null>(null);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [draggingBubbleId, setDraggingBubbleId] = useState<string | null>(null);
  const [linkDragFromPointId, setLinkDragFromPointId] = useState<string | null>(null);
  const [depDragFromEventId, setDepDragFromEventId] = useState<string | null>(null);
  const [dragTimelineId, setDragTimelineId] = useState<string | null>(null);
  const [timelineDropHint, setTimelineDropHint] = useState<{
    targetTimelineId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [timelineResizeState, setTimelineResizeState] = useState<{
    timelineId: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<TimelineContextMenu | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

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

  const pointConnections = useMemo(() => {
    if (!currentNovel) return [];
    return timePointConnectionsByNovel[currentNovel.id] ?? [];
  }, [currentNovel, timePointConnectionsByNovel]);

  const bubbleEvents = useMemo(() => {
    if (!currentNovel) return [];
    return bubbleEventsByNovel[currentNovel.id] ?? [];
  }, [currentNovel, bubbleEventsByNovel]);

  const bubbleDeps = useMemo(() => {
    if (!currentNovel) return [];
    return eventDependenciesByNovel[currentNovel.id] ?? [];
  }, [currentNovel, eventDependenciesByNovel]);

  const pointById = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  const bubbleById = useMemo(() => new Map(bubbleEvents.map((event) => [event.id, event])), [bubbleEvents]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    if (!warning) return;
    const timer = window.setTimeout(() => setWarning(null), 2200);
    return () => window.clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    if (!timelineResizeState) return;
    const onMove = (event: PointerEvent) => {
      const delta = event.clientX - timelineResizeState.startX;
      setTimelineColumnWidth(timelineResizeState.timelineId, timelineResizeState.startWidth + delta);
    };
    const onUp = () => setTimelineResizeState(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [timelineResizeState, setTimelineColumnWidth]);

  const openContextMenu = (x: number, y: number, target: TimelineContextMenu['target']) => {
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
      ...timelines.map((timeline) => ({
        id: timeline.id,
        name: timeline.name,
        color: timeline.color,
        width: timelineColumnWidthsByNovel[currentNovel?.id ?? '']?.[timeline.id] ?? ENTITY_COLUMN_WIDTH
      }))
    ],
    [timelines, timelineColumnWidthsByNovel, currentNovel]
  );

  const columnIndexById = useMemo(
    () => new Map(columns.map((column, index) => [column.id, index])),
    [columns]
  );

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
  const bubblePosition = (event: { anchor_point_id: string; offset: number }) => {
    const anchor = pointById.get(event.anchor_point_id);
    if (!anchor) return 0;
    return clamp01(anchor.position + event.offset);
  };

  const bubbleMaxWidth = (eventBubble: { id: string; timeline_id: string; side: 'left' | 'right'; anchor_point_id: string; offset: number }) => {
    const currentCenter = columnCenterX.get(eventBubble.timeline_id);
    const columnIndex = columnIndexById.get(eventBubble.timeline_id);
    if (currentCenter == null || columnIndex == null) return 180;

    const neighborIndex = eventBubble.side === 'left' ? columnIndex - 1 : columnIndex + 1;
    const neighbor = columns[neighborIndex];
    if (!neighbor) return 220;

    const neighborCenter = columnCenterX.get(neighbor.id);
    if (neighborCenter == null) return 220;

    const betweenLines = Math.max(130, Math.abs(currentCenter - neighborCenter) - 34);
    const selfPos = bubblePosition(eventBubble);
    const neighborHasCloseBubble = bubbleEvents.some((item) => {
      if (item.timeline_id !== neighbor.id) return false;
      return Math.abs(bubblePosition(item) - selfPos) < 0.08;
    });

    if (!neighborHasCloseBubble) {
      return Math.min(360, betweenLines);
    }
    return Math.min(200, betweenLines);
  };

  const createAtClick = (timelineId: string, event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const position = clamp01(y / AXIS_HEIGHT);
    const x = event.clientX - rect.left;

    if (mode === 'point') {
      setBubbleEditor(null);
      setPointEditor({ mode: 'create', position, label: '', x, timelineId });
    } else {
      setPointEditor(null);
      setBubbleEditor({ mode: 'create', position, title: '', x, timelineId });
    }
  };

  const savePointEditor = () => {
    if (!pointEditor || !pointEditor.label.trim()) return;
    if (pointEditor.mode === 'create') {
      addTimePoint(pointEditor.label.trim(), pointEditor.position, pointEditor.timelineId);
    } else if (pointEditor.id) {
      updateTimePoint(pointEditor.id, pointEditor.label.trim());
    }
    setPointEditor(null);
  };

  const saveBubbleEditor = () => {
    if (!bubbleEditor || !bubbleEditor.title.trim()) return;
    if (bubbleEditor.mode === 'create') {
      const created = addBubbleEvent(bubbleEditor.title.trim(), bubbleEditor.timelineId, bubbleEditor.position);
      if (!created) {
        setWarning('Add at least one point on this timeline before creating an event.');
        return;
      }
    } else if (bubbleEditor.id) {
      updateBubbleEventTitle(bubbleEditor.id, bubbleEditor.title.trim());
    }
    setBubbleEditor(null);
  };

  return (
    <section className="panel timeline-panel" ref={panelRef}>
      <h2>Timeline Anchors</h2>
      <div className="timeline-mode-row">
        <button className={mode === 'point' ? 'mode-active' : ''} onClick={() => setMode('point')}>
          Point Mode
        </button>
        <button className={mode === 'event' ? 'mode-active' : ''} onClick={() => setMode('event')}>
          Event Mode
        </button>
      </div>
      <p className="muted">
        Click timeline in current mode. Event bubbles anchor to nearest point above (or first below).
      </p>
      {warning && <p className="timeline-warning">{warning}</p>}

      <div className="anchor-board">
        <div className="anchor-content" style={{ width: `${contentWidth}px` }}>
          <svg className="connection-layer" width={contentWidth} height={AXIS_HEIGHT}>
            {pointConnections.map((connection) => {
              const from = pointById.get(connection.from_point_id);
              const to = pointById.get(connection.to_point_id);
              if (!from || !to) return null;
              const x1 = columnCenterX.get(from.timeline_id);
              const x2 = columnCenterX.get(to.timeline_id);
              if (x1 == null || x2 == null) return null;
              return (
                <line
                  key={connection.id}
                  x1={x1}
                  y1={positionToTop(from.position)}
                  x2={x2}
                  y2={positionToTop(to.position)}
                  stroke="rgba(31, 41, 51, 0.45)"
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

            {bubbleDeps.map((dep) => {
              const from = bubbleById.get(dep.from_event_id);
              const to = bubbleById.get(dep.to_event_id);
              if (!from || !to) return null;
              const center = columnCenterX.get(from.timeline_id);
              if (center == null) return null;
              const fromX = center + (from.side === 'left' ? -BUBBLE_X_OFFSET : BUBBLE_X_OFFSET);
              const toX = center + (to.side === 'left' ? -BUBBLE_X_OFFSET : BUBBLE_X_OFFSET);
              return (
                <line
                  key={dep.id}
                  x1={fromX}
                  y1={positionToTop(bubblePosition(from))}
                  x2={toX}
                  y2={positionToTop(bubblePosition(to))}
                  stroke="rgba(215, 58, 73, 0.7)"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                  className="bubble-dependency-line"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openContextMenu(e.clientX, e.clientY, { type: 'bubble-dependency', id: dep.id });
                  }}
                />
              );
            })}
          </svg>

          {columns.map((column) => {
            const columnPoints = points.filter((point) => point.timeline_id === column.id);
            const columnBubbles = bubbleEvents.filter((event) => event.timeline_id === column.id);
            const isMain = column.id === MAIN_TIMELINE_ID;
            const showHover = hoverState != null;
            const showDot = hoverState?.timelineId === column.id;

            return (
              <div
                key={column.id}
                className={`timeline-column${isMain ? ' main-column' : ''}`}
                style={{ width: `${column.width}px`, flexBasis: `${column.width}px` }}
                onDragOver={(e) => {
                  if (isMain || !dragTimelineId || dragTimelineId === column.id) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const position = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                  setTimelineDropHint({ targetTimelineId: column.id, position });
                }}
                onDragLeave={() => {
                  setTimelineDropHint((prev) =>
                    prev?.targetTimelineId === column.id ? null : prev
                  );
                }}
                onDrop={(e) => {
                  if (isMain || !dragTimelineId || dragTimelineId === column.id) return;
                  e.preventDefault();
                  const position =
                    timelineDropHint?.targetTimelineId === column.id
                      ? timelineDropHint.position
                      : 'after';
                  void reorderTimelines(dragTimelineId, column.id, position);
                  setDragTimelineId(null);
                  setTimelineDropHint(null);
                }}
              >
                <h3
                  className={`timeline-column-title${isMain ? ' non-draggable' : ''}${
                    timelineDropHint?.targetTimelineId === column.id
                      ? ` drop-${timelineDropHint.position}`
                      : ''
                  }`}
                  draggable={!isMain}
                  onDragStart={(e) => {
                    if (isMain) return;
                    setDragTimelineId(column.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/x-novelic-timeline-id', column.id);
                  }}
                  onDragEnd={() => {
                    setDragTimelineId(null);
                    setTimelineDropHint(null);
                  }}
                >
                  {column.name}
                  {!isMain && (
                    <span
                      className="timeline-width-handle"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTimelineResizeState({
                          timelineId: column.id,
                          startX: e.clientX,
                          startWidth: column.width
                        });
                      }}
                      title="Drag to change timeline spacing"
                    />
                  )}
                </h3>
                <div
                  className={`timeline-axis ${isMain ? 'main-axis' : 'entity-axis'}`}
                  onClick={(event) => createAtClick(column.id, event)}
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
                        setPointEditor({
                          mode: 'edit',
                          id: point.id,
                          position: point.position,
                          label: point.label,
                          x: target.left - axisRect.left,
                          timelineId: point.timeline_id
                        });
                        setBubbleEditor(null);
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
                        if (linkDragFromPointId && linkDragFromPointId !== point.id) {
                          e.preventDefault();
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const fromId = e.dataTransfer.getData('application/x-novelic-point-id') || linkDragFromPointId;
                        if (!fromId || fromId === point.id) return;
                        addTimePointConnection(fromId, point.id);
                        setLinkDragFromPointId(null);
                      }}
                    >
                      <span>{point.label}</span>
                      <span
                        className="point-link-handle"
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setLinkDragFromPointId(point.id);
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('application/x-novelic-point-id', point.id);
                        }}
                        onDragEnd={() => setLinkDragFromPointId(null)}
                        title="Drag to another timeline point to connect"
                      />
                    </button>
                  ))}

                  {columnBubbles.map((eventBubble) => {
                    const pos = bubblePosition(eventBubble);
                    const sideClass = eventBubble.side === 'left' ? 'bubble-left' : 'bubble-right';
                    const availableWidth = bubbleMaxWidth(eventBubble);
                    return (
                      <div
                        key={eventBubble.id}
                        className={`timeline-bubble ${sideClass}${draggingBubbleId === eventBubble.id ? ' is-dragging' : ''}`}
                        style={{
                          top: `${positionToTop(pos)}px`,
                          width: `${availableWidth}px`,
                          maxWidth: `${availableWidth}px`
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          const target = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                          const axisRect = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
                          setBubbleEditor({
                            mode: 'edit',
                            id: eventBubble.id,
                            position: pos,
                            title: eventBubble.title,
                            x: target.left - axisRect.left,
                            timelineId: eventBubble.timeline_id
                          });
                          setPointEditor(null);
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          setDraggingBubbleId(eventBubble.id);
                          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (draggingBubbleId !== eventBubble.id) return;
                          const axis = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
                          const nextPosition = clamp01((e.clientY - axis.top) / AXIS_HEIGHT);
                          const side = e.clientX < axis.left + axis.width / 2 ? 'left' : 'right';
                          if (side !== eventBubble.side) {
                            setBubbleEventSide(eventBubble.id, side);
                          }
                          const ok = moveBubbleEvent(eventBubble.id, nextPosition);
                          if (!ok) {
                            setWarning('Dependency order blocks this move.');
                          }
                        }}
                        onPointerUp={(e) => {
                          if (draggingBubbleId !== eventBubble.id) return;
                          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
                          setDraggingBubbleId(null);
                          settleBubbleEventPosition(eventBubble.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openContextMenu(e.clientX, e.clientY, { type: 'bubble', id: eventBubble.id });
                        }}
                        onDragOver={(e) => {
                          const fromId = e.dataTransfer.getData('application/x-novelic-event-id') || depDragFromEventId;
                          if (fromId && fromId !== eventBubble.id) {
                            e.preventDefault();
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const fromId = e.dataTransfer.getData('application/x-novelic-event-id') || depDragFromEventId;
                          if (!fromId || fromId === eventBubble.id) return;
                          const ok = addEventDependency(fromId, eventBubble.id);
                          if (!ok) {
                            setWarning('Dependencies can be created only within the same timeline.');
                          }
                          setDepDragFromEventId(null);
                        }}
                      >
                        <span>{eventBubble.title}</span>
                        <span
                          className="bubble-dependency-handle"
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation();
                            setDepDragFromEventId(eventBubble.id);
                            e.dataTransfer.effectAllowed = 'link';
                            e.dataTransfer.setData('application/x-novelic-event-id', eventBubble.id);
                          }}
                          onDragEnd={() => setDepDragFromEventId(null)}
                          title="Drag to another event to create dependency"
                        />
                      </div>
                    );
                  })}

                  {pointEditor && pointEditor.timelineId === column.id && (
                    <div
                      className="anchor-editor-inline"
                      style={{ top: `${positionToTop(pointEditor.position)}px`, left: `${Math.max(90, pointEditor.x)}px` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={pointEditor.label}
                        placeholder="Point label"
                        onChange={(e) => setPointEditor((prev) => (prev ? { ...prev, label: e.target.value } : prev))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') savePointEditor();
                          if (e.key === 'Escape') setPointEditor(null);
                        }}
                      />
                      <div className="anchor-editor-actions">
                        <button onClick={() => setPointEditor(null)}>Cancel</button>
                        <button onClick={savePointEditor}>Save</button>
                      </div>
                    </div>
                  )}

                  {bubbleEditor && bubbleEditor.timelineId === column.id && (
                    <div
                      className="anchor-editor-inline"
                      style={{ top: `${positionToTop(bubbleEditor.position)}px`, left: `${Math.max(90, bubbleEditor.x)}px` }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        autoFocus
                        value={bubbleEditor.title}
                        placeholder="Event title"
                        onChange={(e) => setBubbleEditor((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveBubbleEditor();
                          if (e.key === 'Escape') setBubbleEditor(null);
                        }}
                      />
                      <div className="anchor-editor-actions">
                        <button onClick={() => setBubbleEditor(null)}>Cancel</button>
                        <button onClick={saveBubbleEditor}>Save</button>
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
              if (contextMenu.target.type === 'bubble') {
                deleteBubbleEvent(contextMenu.target.id);
              }
              if (contextMenu.target.type === 'bubble-dependency') {
                deleteEventDependency(contextMenu.target.id);
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

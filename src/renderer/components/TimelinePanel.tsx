import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent, type UIEvent, type WheelEvent } from 'react';
import { useNovelStore } from '../store/useNovelStore';

const AXIS_HEIGHT = 720;
const DEFAULT_VERTICAL_MAX = 1;
const HORIZONTAL_EDGE_TRIGGER_PX = 52;
const HORIZONTAL_MIN_BUFFER_PX = 72;
const HORIZONTAL_GROWTH_FACTOR = 0.15;
const HORIZONTAL_MAX_HEADROOM_FACTOR = 0.35;
const HORIZONTAL_SHRINK_STEP_FACTOR = 0.2;
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

function clampPosition(value: number, maxPosition: number): number {
  return Math.max(0, Math.min(maxPosition, value));
}

function darkenHexColor(color: string, amount = 0.24): string {
  const hex = color.trim();
  const normalized = hex.startsWith('#') ? hex.slice(1) : hex;
  const isShortHex = normalized.length === 3;
  const isFullHex = normalized.length === 6;

  if (!/^[0-9a-fA-F]+$/.test(normalized) || (!isShortHex && !isFullHex)) {
    return color;
  }

  const expanded = isShortHex
    ? normalized
        .split('')
        .map((ch) => ch + ch)
        .join('')
    : normalized;

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const scale = Math.max(0, Math.min(1, 1 - amount));

  const toHex = (value: number) =>
    Math.round(value * scale)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function TimelinePanel() {
  const panelRef = useRef<HTMLElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const lastBoardScrollLeftRef = useRef(0);
  const lastHoverYearRef = useRef<number | null>(null);

  const timelines = useNovelStore((s) => s.timelines);
  const currentNovel = useNovelStore((s) => s.currentNovel);
  const currentChapter = useNovelStore((s) => s.currentChapter);
  const timePointsByNovel = useNovelStore((s) => s.timePointsByNovel);
  const timePointConnectionsByNovel = useNovelStore((s) => s.timePointConnectionsByNovel);
  const bubbleEventsByNovel = useNovelStore((s) => s.bubbleEventsByNovel);
  const eventDependenciesByNovel = useNovelStore((s) => s.eventDependenciesByNovel);
  const timelineColumnWidthsByNovel = useNovelStore((s) => s.timelineColumnWidthsByNovel);
  const timelineVerticalMaxByNovel = useNovelStore((s) => s.timelineVerticalMaxByNovel);

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
  const ensureTimelineVerticalExtent = useNovelStore((s) => s.ensureTimelineVerticalExtent);
  const captureLayoutSnapshot = useNovelStore((s) => s.captureLayoutSnapshot);

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
  const [virtualContentWidth, setVirtualContentWidth] = useState(0);

  const layoutScopeId = useMemo(() => {
    if (!currentNovel) return null;
    return `${currentNovel.id}::${currentChapter?.id ?? '__no_chapter__'}`;
  }, [currentNovel, currentChapter]);

  const rawPoints = useMemo(() => {
    if (!layoutScopeId) return [];
    return (timePointsByNovel[layoutScopeId] ?? []).slice().sort((a, b) => a.position - b.position);
  }, [layoutScopeId, timePointsByNovel]);

  const points = useMemo(
    () =>
      rawPoints.map((point) => ({
        ...point,
        timeline_id: point.timeline_id ?? MAIN_TIMELINE_ID
      })),
    [rawPoints]
  );

  const pointConnections = useMemo(() => {
    if (!layoutScopeId) return [];
    return timePointConnectionsByNovel[layoutScopeId] ?? [];
  }, [layoutScopeId, timePointConnectionsByNovel]);

  const bubbleEvents = useMemo(() => {
    if (!layoutScopeId) return [];
    return bubbleEventsByNovel[layoutScopeId] ?? [];
  }, [layoutScopeId, bubbleEventsByNovel]);

  const bubbleDeps = useMemo(() => {
    if (!layoutScopeId) return [];
    return eventDependenciesByNovel[layoutScopeId] ?? [];
  }, [layoutScopeId, eventDependenciesByNovel]);

  const linkedDraggedEventIds = useMemo(() => {
    const activeEventId = draggingBubbleId ?? depDragFromEventId;
    if (!activeEventId) return new Set<string>();
    const bubbleById = new Map(bubbleEvents.map((event) => [event.id, event]));

    const adjacency = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set<string>());
      adjacency.get(a)?.add(b);
    };

    bubbleDeps.forEach((dep) => {
      const from = bubbleById.get(dep.from_event_id);
      const to = bubbleById.get(dep.to_event_id);
      if (!from || !to) return;
      if (from.timeline_id === to.timeline_id) return;
      link(dep.from_event_id, dep.to_event_id);
      link(dep.to_event_id, dep.from_event_id);
    });

    const visited = new Set<string>([activeEventId]);
    const queue = [activeEventId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      const neighbors = adjacency.get(current);
      if (!neighbors) continue;
      neighbors.forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }

    return visited;
  }, [draggingBubbleId, depDragFromEventId, bubbleDeps, bubbleEvents]);

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
    const onUp = () => {
      setTimelineResizeState(null);
      captureLayoutSnapshot();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [timelineResizeState, setTimelineColumnWidth, captureLayoutSnapshot]);

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
        width: timelineColumnWidthsByNovel[layoutScopeId ?? '']?.[timeline.id] ?? ENTITY_COLUMN_WIDTH
      }))
    ],
    [timelines, timelineColumnWidthsByNovel, layoutScopeId]
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

  const verticalMax = currentNovel
    ? timelineVerticalMaxByNovel[layoutScopeId ?? ''] ?? DEFAULT_VERTICAL_MAX
    : DEFAULT_VERTICAL_MAX;
  const axisHeight = Math.max(AXIS_HEIGHT, Math.round(AXIS_HEIGHT * verticalMax));
  const renderedContentWidth = Math.max(contentWidth, virtualContentWidth || contentWidth);

  const positionToTop = (position: number) => clampPosition(position, verticalMax) * AXIS_HEIGHT;
  const bubblePosition = (event: { anchor_point_id: string; offset: number }) => {
    const anchor = pointById.get(event.anchor_point_id);
    if (!anchor) return 0;
    return clampPosition(anchor.position + event.offset, verticalMax);
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
    const requested = y / AXIS_HEIGHT;
    const nextMax = ensureTimelineVerticalExtent(requested + 0.12);
    const position = clampPosition(requested, nextMax);
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
    captureLayoutSnapshot();
    if (pointEditor.mode === 'create') {
      addTimePoint(pointEditor.label.trim(), pointEditor.position, pointEditor.timelineId);
    } else if (pointEditor.id) {
      updateTimePoint(pointEditor.id, pointEditor.label.trim());
    }
    captureLayoutSnapshot();
    setPointEditor(null);
  };

  const saveBubbleEditor = () => {
    if (!bubbleEditor || !bubbleEditor.title.trim()) return;
    captureLayoutSnapshot();
    if (bubbleEditor.mode === 'create') {
      const created = addBubbleEvent(bubbleEditor.title.trim(), bubbleEditor.timelineId, bubbleEditor.position);
      if (!created) {
        setWarning('Add at least one point on this timeline before creating an event.');
        return;
      }
    } else if (bubbleEditor.id) {
      updateBubbleEventTitle(bubbleEditor.id, bubbleEditor.title.trim());
    }
    captureLayoutSnapshot();
    setBubbleEditor(null);
  };

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const width = board.clientWidth;
    setVirtualContentWidth((prev) => {
      const cap = contentWidth + width;
      const base = Math.max(contentWidth, contentWidth + HORIZONTAL_MIN_BUFFER_PX);
      const seeded = prev > 0 ? prev : base;
      return Math.max(contentWidth, Math.min(seeded, cap));
    });
  }, [contentWidth, currentNovel?.id]);

  useEffect(() => {
    const onResize = () => {
      const board = boardRef.current;
      if (!board) return;
      const width = board.clientWidth;
      setVirtualContentWidth((prev) => {
        const cap = contentWidth + width;
        if (prev <= 0) {
          return Math.max(contentWidth, contentWidth + HORIZONTAL_MIN_BUFFER_PX);
        }
        return Math.max(contentWidth, Math.min(prev, cap));
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [contentWidth]);

  const updateHorizontalVirtualWidth = (scrollLeft: number, clientWidth: number) => {
    setVirtualContentWidth((prev) => {
      const current = Math.max(contentWidth, prev || contentWidth);
      const maxHeadroomPx = Math.max(
        HORIZONTAL_MIN_BUFFER_PX,
        Math.round(clientWidth * HORIZONTAL_MAX_HEADROOM_FACTOR)
      );
      const cap = contentWidth + maxHeadroomPx;
      let next = Math.max(contentWidth, Math.min(current, cap));
      const nearRight = scrollLeft + clientWidth >= next - HORIZONTAL_EDGE_TRIGGER_PX;
      if (nearRight && next < cap) {
        const chunk = Math.max(36, Math.round(clientWidth * HORIZONTAL_GROWTH_FACTOR));
        next = Math.min(cap, next + chunk);
      }

      const desired = Math.max(contentWidth + HORIZONTAL_MIN_BUFFER_PX, scrollLeft + clientWidth + HORIZONTAL_MIN_BUFFER_PX);
      if (next > desired) {
        const shrinkStep = Math.max(24, Math.round(clientWidth * HORIZONTAL_SHRINK_STEP_FACTOR));
        next = Math.max(desired, next - shrinkStep);
      }

      return next;
    });
  };

  const handleBoardScroll = (event: UIEvent<HTMLDivElement>) => {
    const board = event.currentTarget;
    const horizontalChanged = Math.abs(board.scrollLeft - lastBoardScrollLeftRef.current) > 0.5;
    if (horizontalChanged) {
      lastBoardScrollLeftRef.current = board.scrollLeft;
      updateHorizontalVirtualWidth(board.scrollLeft, board.clientWidth);
    }

    const nearBottom = board.scrollTop + board.clientHeight >= axisHeight - 56;
    if (nearBottom) {
      const requestedPosition = (board.scrollTop + board.clientHeight) / AXIS_HEIGHT + 0.1;
      ensureTimelineVerticalExtent(requestedPosition);
    }
  };

  const handleBoardWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY <= 0) return;
    const board = event.currentTarget;
    const requestedPosition =
      (board.scrollTop + board.clientHeight + Math.min(event.deltaY, 220)) / AXIS_HEIGHT + 0.08;
    ensureTimelineVerticalExtent(requestedPosition);
  };

  return (
    <section className="panel timeline-panel" ref={panelRef}>
      <h2>{currentChapter?.name ?? 'Chapter'}</h2>
      <div className="timeline-mode-row">
        <button
          aria-pressed={mode === 'point'}
          className={mode === 'point' ? 'mode-active' : ''}
          onClick={() => setMode('point')}
        >
          Point Mode
        </button>
        <button
          aria-pressed={mode === 'event'}
          className={mode === 'event' ? 'mode-active' : ''}
          onClick={() => setMode('event')}
        >
          Event Mode
        </button>
      </div>
      <p className="muted">
        Click timeline in current mode. Event bubbles anchor to nearest point above (or first below).
      </p>
      {warning && <p className="timeline-warning">{warning}</p>}

      <div
        className="anchor-board"
        ref={boardRef}
        onScroll={handleBoardScroll}
        onWheel={handleBoardWheel}
      >
        <div
          className="anchor-content"
          style={{ width: `${renderedContentWidth}px`, minHeight: `${axisHeight + 28}px` }}
        >
          <svg className="connection-layer" width={renderedContentWidth} height={axisHeight}>
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
              const fromCenter = columnCenterX.get(from.timeline_id);
              const toCenter = columnCenterX.get(to.timeline_id);
              if (fromCenter == null || toCenter == null) return null;
              const fromX = fromCenter + (from.side === 'left' ? -BUBBLE_X_OFFSET : BUBBLE_X_OFFSET);
              const toX = toCenter + (to.side === 'left' ? -BUBBLE_X_OFFSET : BUBBLE_X_OFFSET);
              const isLinked =
                linkedDraggedEventIds.has(dep.from_event_id) &&
                linkedDraggedEventIds.has(dep.to_event_id);
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
                  className={`bubble-dependency-line${isLinked ? ' is-linked' : ''}`}
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
                        captureLayoutSnapshot();
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
                  style={{ height: `${axisHeight}px` }}
                  onClick={(event) => createAtClick(column.id, event)}
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const y = event.clientY - rect.top;
                    const requested = y / AXIS_HEIGHT;
                    const nextMax = ensureTimelineVerticalExtent(requested + 0.08);
                    const nextPosition = clampPosition(requested, nextMax);
                    setHoverState({ timelineId: column.id, position: nextPosition });
                    const fakeYear = 1900 + Math.round(nextPosition * 200);
                    if (lastHoverYearRef.current !== fakeYear) {
                      lastHoverYearRef.current = fakeYear;
                      setCursor(new Date(Date.UTC(fakeYear, 0, 1)).toISOString());
                    }
                  }}
                  onMouseLeave={() => {
                    setHoverState(null);
                    lastHoverYearRef.current = null;
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
                        captureLayoutSnapshot();
                        setDraggingPointId(point.id);
                        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (draggingPointId !== point.id) return;
                        const axis = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
                        const requested = (e.clientY - axis.top) / AXIS_HEIGHT;
                        const nextMax = ensureTimelineVerticalExtent(requested + 0.1);
                        const nextPosition = clampPosition(requested, nextMax);
                        setHoverState({ timelineId: point.timeline_id, position: nextPosition });
                        updateTimePointPosition(point.id, nextPosition);
                      }}
                      onPointerUp={(e) => {
                        if (draggingPointId !== point.id) return;
                        (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
                        setDraggingPointId(null);
                        captureLayoutSnapshot();
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
                        captureLayoutSnapshot();
                        addTimePointConnection(fromId, point.id);
                        captureLayoutSnapshot();
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
                    const isLinked = linkedDraggedEventIds.has(eventBubble.id);
                    const timelineColor = isMain ? '#d73a49' : column.color;
                    const anchorDotColor = darkenHexColor(timelineColor, 0.3);
                    return (
                      <Fragment key={eventBubble.id}>
                        <div
                          className="bubble-anchor-dot"
                          style={{ top: `${positionToTop(pos)}px`, backgroundColor: anchorDotColor }}
                        />
                        <div
                          className={`timeline-bubble ${sideClass}${draggingBubbleId === eventBubble.id ? ' is-dragging' : ''}${isLinked ? ' is-linked' : ''}`}
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
                            captureLayoutSnapshot();
                            setDraggingBubbleId(eventBubble.id);
                            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
                          }}
                          onPointerMove={(e) => {
                            if (draggingBubbleId !== eventBubble.id) return;
                            const axis = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
                            const requested = (e.clientY - axis.top) / AXIS_HEIGHT;
                            const nextMax = ensureTimelineVerticalExtent(requested + 0.1);
                            const nextPosition = clampPosition(requested, nextMax);
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
                            captureLayoutSnapshot();
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
                            captureLayoutSnapshot();
                            const ok = addEventDependency(fromId, eventBubble.id);
                            if (!ok) {
                              setWarning('Could not create dependency.');
                            }
                            captureLayoutSnapshot();
                            setDepDragFromEventId(null);
                          }}
                        >
                          <span>{eventBubble.title}</span>
                          <span
                            className="bubble-dependency-handle"
                            draggable
                            onPointerDown={(e) => {
                              e.stopPropagation();
                            }}
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
                      </Fragment>
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
                captureLayoutSnapshot();
                deleteTimePoint(contextMenu.target.id);
                captureLayoutSnapshot();
              }
              if (contextMenu.target.type === 'connection' && currentNovel) {
                const existing = timePointConnectionsByNovel[layoutScopeId ?? ''] ?? [];
                const next = existing.filter((item) => item.id !== contextMenu.target.id);
                captureLayoutSnapshot();
                useNovelStore.setState((state) => ({
                  timePointConnectionsByNovel: {
                    ...state.timePointConnectionsByNovel,
                    [layoutScopeId ?? '']: next
                  }
                }));
                captureLayoutSnapshot();
              }
              if (contextMenu.target.type === 'bubble') {
                captureLayoutSnapshot();
                deleteBubbleEvent(contextMenu.target.id);
                captureLayoutSnapshot();
              }
              if (contextMenu.target.type === 'bubble-dependency') {
                captureLayoutSnapshot();
                deleteEventDependency(contextMenu.target.id);
                captureLayoutSnapshot();
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

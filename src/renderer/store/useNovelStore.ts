import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import type {
  CreateEventInput,
  Novel,
  NovelPayload,
  Timeline,
  TimelineEvent,
  UpdateEventInput
} from '../../shared/types';

interface TimePoint {
  id: string;
  label: string;
  position: number;
  timeline_id: string;
}

interface TimePointConnection {
  id: string;
  from_point_id: string;
  to_point_id: string;
}

type BubbleSide = 'left' | 'right';

interface TimelineBubbleEvent {
  id: string;
  timeline_id: string;
  anchor_point_id: string;
  title: string;
  side: BubbleSide;
  offset: number;
}

interface TimelineEventDependency {
  id: string;
  timeline_id: string;
  from_event_id: string;
  to_event_id: string;
}

interface BubbleZone {
  id: string;
  timeline_id: string;
  center: number;
  clearance: number;
}

interface LocalSnapshot {
  novel: Novel;
  timelines: Timeline[];
  events: TimelineEvent[];
}

function cloneSnapshot(snapshot: LocalSnapshot): LocalSnapshot {
  return {
    novel: { ...snapshot.novel },
    timelines: snapshot.timelines.map((timeline) => ({ ...timeline })),
    events: snapshot.events.map((event) => ({ ...event }))
  };
}

interface NovelStore {
  novels: Novel[];
  currentNovel: Novel | null;
  timelines: Timeline[];
  events: TimelineEvent[];
  selectedCursor: string | null;
  overlappingEvents: TimelineEvent[];
  undo_history: LocalSnapshot[];
  undo_index: number;
  searchQuery: string;
  timePointsByNovel: Record<string, TimePoint[]>;
  timePointConnectionsByNovel: Record<string, TimePointConnection[]>;
  bubbleEventsByNovel: Record<string, TimelineBubbleEvent[]>;
  eventDependenciesByNovel: Record<string, TimelineEventDependency[]>;
  timelineColumnWidthsByNovel: Record<string, Record<string, number>>;
  initialize: () => Promise<void>;
  createNovel: (name: string) => Promise<void>;
  selectNovel: (novelId: string) => Promise<void>;
  createTimeline: (name: string, color: string) => Promise<void>;
  updateTimelineColor: (timelineId: string, color: string) => Promise<void>;
  updateTimelineName: (timelineId: string, name: string) => Promise<void>;
  createEvent: (input: Omit<CreateEventInput, 'novel_id'>) => Promise<void>;
  updateEvent: (input: UpdateEventInput) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  deleteTimeline: (timelineId: string) => Promise<void>;
  setCursor: (cursorIso: string | null) => Promise<void>;
  setSearchQuery: (query: string) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  exportNovelJson: () => Promise<void>;
  exportTimelineCsv: (timelineId: string) => Promise<void>;
  importNovelJson: () => Promise<void>;
  addTimePoint: (label: string, position: number, timelineId: string) => void;
  updateTimePoint: (id: string, label: string) => void;
  updateTimePointPosition: (id: string, position: number) => void;
  deleteTimePoint: (id: string) => void;
  addTimePointConnection: (fromPointId: string, toPointId: string) => void;
  addBubbleEvent: (title: string, timelineId: string, preferredPosition: number) => boolean;
  updateBubbleEventTitle: (eventId: string, title: string) => void;
  moveBubbleEvent: (eventId: string, nextPosition: number) => boolean;
  settleBubbleEventPosition: (eventId: string) => boolean;
  deleteBubbleEvent: (eventId: string) => void;
  addEventDependency: (fromEventId: string, toEventId: string) => boolean;
  deleteEventDependency: (dependencyId: string) => void;
  setBubbleEventSide: (eventId: string, side: BubbleSide) => void;
  setTimelineColumnWidth: (timelineId: string, width: number) => void;
  reorderTimelines: (
    sourceTimelineId: string,
    targetTimelineId: string,
    dropPosition: 'before' | 'after'
  ) => Promise<void>;
}

const MAX_UNDO = 50;

function makeSnapshot(state: NovelStore): LocalSnapshot | null {
  if (!state.currentNovel) {
    return null;
  }
  return {
    novel: { ...state.currentNovel },
    timelines: state.timelines.map((timeline) => ({ ...timeline })),
    events: state.events.map((event) => ({ ...event }))
  };
}

function snapshotFromPayload(payload: NovelPayload): LocalSnapshot {
  return {
    novel: { ...payload.novel },
    timelines: payload.timelines.map((timeline) => ({ ...timeline })),
    events: payload.events.map((event) => ({ ...event }))
  };
}

function serializeSnapshot(snapshot: LocalSnapshot): string {
  return JSON.stringify(snapshot);
}

async function pushSnapshotToDb(snapshot: LocalSnapshot): Promise<void> {
  await window.novelic.state.createSnapshot(snapshot.novel.id, serializeSnapshot(snapshot));
}

function appendHistory(history: LocalSnapshot[], undoIndex: number, snapshot: LocalSnapshot): LocalSnapshot[] {
  const base = history.slice(0, undoIndex + 1);
  const next = [...base, cloneSnapshot(snapshot)];
  return next.slice(-MAX_UNDO);
}

function selectAnchorPoint(points: TimePoint[], timelineId: string, preferredPosition: number): TimePoint | null {
  const candidates = points
    .filter((point) => point.timeline_id === timelineId)
    .sort((a, b) => a.position - b.position);
  if (candidates.length === 0) return null;

  let above: TimePoint | null = null;
  for (let i = 0; i < candidates.length; i += 1) {
    if (candidates[i].position <= preferredPosition) {
      above = candidates[i];
    } else {
      break;
    }
  }
  if (above) return above;
  return candidates[0];
}

function bubblePosition(event: TimelineBubbleEvent, pointsById: Map<string, TimePoint>): number {
  const anchor = pointsById.get(event.anchor_point_id);
  if (!anchor) return 0;
  return anchor.position + event.offset;
}

function canMoveBubbleEvent(
  event: TimelineBubbleEvent,
  nextPosition: number,
  bubbles: TimelineBubbleEvent[],
  dependencies: TimelineEventDependency[],
  pointsById: Map<string, TimePoint>
): boolean {
  const byId = new Map(bubbles.map((item) => [item.id, item]));
  const epsilon = 0.0001;

  for (let i = 0; i < dependencies.length; i += 1) {
    const dep = dependencies[i];
    if (dep.timeline_id !== event.timeline_id) continue;
    const from = byId.get(dep.from_event_id);
    const to = byId.get(dep.to_event_id);
    if (!from || !to) continue;

    const fromPos = from.id === event.id ? nextPosition : bubblePosition(from, pointsById);
    const toPos = to.id === event.id ? nextPosition : bubblePosition(to, pointsById);
    if (fromPos >= toPos - epsilon) {
      return false;
    }
  }

  return true;
}

function desiredBubblePosition(
  event: TimelineBubbleEvent,
  desiredPosition: number,
  points: TimePoint[]
): TimelineBubbleEvent {
  const anchor = selectAnchorPoint(points, event.timeline_id, desiredPosition);
  if (!anchor) return event;
  const clamped = Math.max(0, Math.min(1, desiredPosition));
  return {
    ...event,
    anchor_point_id: anchor.id,
    offset: clamped - anchor.position
  };
}

function anchoredBubblePosition(
  event: TimelineBubbleEvent,
  desiredPosition: number,
  pointsById: Map<string, TimePoint>,
  points: TimePoint[]
): TimelineBubbleEvent {
  const anchor = pointsById.get(event.anchor_point_id);
  const clamped = Math.max(0, Math.min(1, desiredPosition));
  if (!anchor) {
    return desiredBubblePosition(event, clamped, points);
  }
  return {
    ...event,
    offset: clamped - anchor.position
  };
}

const AXIS_HEIGHT_PX = 720;
const BASE_MIN_GAP = 0.01875;
const BUBBLE_MIN_HEIGHT_PX = 24;
const BUBBLE_BORDER_PX = 4;
const BUBBLE_VERTICAL_PADDING_PX = 7;
const BUBBLE_LINE_HEIGHT_PX = 14;
const BUBBLE_CHARS_PER_LINE = 24;
const BUBBLE_VISIBLE_EDGE_GAP_PX = 6;
const TIME_POINT_RADIUS_PX = 9;
const TIME_POINT_VISIBLE_GAP_PX = 4;
const TIME_POINT_MIN_GAP = 0.005;

function estimatedBubbleHeightPx(title: string): number {
  const lines = Math.max(1, Math.ceil(title.trim().length / BUBBLE_CHARS_PER_LINE));
  const contentHeight = lines * BUBBLE_LINE_HEIGHT_PX + BUBBLE_VERTICAL_PADDING_PX + BUBBLE_BORDER_PX;
  return Math.max(BUBBLE_MIN_HEIGHT_PX, contentHeight);
}

function requiredGap(upper: TimelineBubbleEvent, lower: TimelineBubbleEvent): number {
  const upperH = estimatedBubbleHeightPx(upper.title);
  const lowerH = estimatedBubbleHeightPx(lower.title);
  const halfStackWithVisibleGap = (upperH + lowerH) / 2 + BUBBLE_VISIBLE_EDGE_GAP_PX;
  const normalized = halfStackWithVisibleGap / AXIS_HEIGHT_PX;
  return Math.max(BASE_MIN_GAP, normalized);
}

function pointClearance(event: TimelineBubbleEvent): number {
  const halfBubble = estimatedBubbleHeightPx(event.title) / 2;
  const px = halfBubble + TIME_POINT_RADIUS_PX + TIME_POINT_VISIBLE_GAP_PX;
  return Math.max(BASE_MIN_GAP, px / AXIS_HEIGHT_PX);
}

function eventScopeBounds(event: TimelineBubbleEvent, points: TimePoint[]): { min: number; max: number } {
  const timelinePoints = points
    .filter((point) => point.timeline_id === event.timeline_id)
    .sort((a, b) => a.position - b.position);

  const anchorIndex = timelinePoints.findIndex((point) => point.id === event.anchor_point_id);
  if (anchorIndex < 0) {
    return { min: 0, max: 1 };
  }

  const anchorPos = timelinePoints[anchorIndex].position;
  const prevPoint = timelinePoints[anchorIndex - 1];
  const nextPoint = timelinePoints[anchorIndex + 1];

  // Keep bubbles on their anchor side:
  // offset < 0 => bubble stays above anchor; offset >= 0 => bubble stays below anchor.
  if (event.offset < 0) {
    const min = prevPoint ? prevPoint.position + BASE_MIN_GAP : 0;
    const max = anchorPos - BASE_MIN_GAP;
    return { min, max: Math.max(min, max) };
  }

  const min = anchorPos + BASE_MIN_GAP;
  const max = nextPoint ? nextPoint.position - BASE_MIN_GAP : 1;
  return { min, max: Math.max(min, max) };
}

function slideTimelinePointsFromBubbles(
  timelinePoints: TimePoint[],
  timelineBubbles: TimelineBubbleEvent[],
  preferredBubbleId?: string,
  preferredBubbleCenter?: number
): { nextPoints: TimePoint[]; deltas: Map<string, number> } {
  if (timelinePoints.length === 0 || timelineBubbles.length === 0) {
    return { nextPoints: timelinePoints, deltas: new Map<string, number>() };
  }

  const points = [...timelinePoints].sort((a, b) => a.position - b.position);
  const pointIndex = new Map(points.map((point, index) => [point.id, index]));
  const pointsById = new Map(points.map((point) => [point.id, point]));
  const bubbleZones = timelineBubbles.map((bubble) => ({
    id: bubble.id,
    center: bubblePosition(bubble, pointsById),
    clearance: pointClearance(bubble)
  }));
  const preferredZone = preferredBubbleId
    ? (() => {
        const found = bubbleZones.find((zone) => zone.id === preferredBubbleId);
        if (!found) return undefined;
        if (preferredBubbleCenter == null) return found;
        return {
          ...found,
          center: preferredBubbleCenter
        };
      })()
    : undefined;

  const projected = points.map((point) => point.position);

  for (let pass = 0; pass < 8; pass += 1) {
    for (let i = 0; i < projected.length; i += 1) {
      let lowerBound = 0;
      let upperBound = 1;
      const current = projected[i];
      let preferredDirection: 'up' | 'down' | null = null;

      if (preferredZone) {
        const preferredDist = current - preferredZone.center;
        if (Math.abs(preferredDist) < preferredZone.clearance) {
          if (preferredDist >= 0) {
            preferredDirection = 'down';
            lowerBound = Math.max(lowerBound, preferredZone.center + preferredZone.clearance);
          } else {
            preferredDirection = 'up';
            upperBound = Math.min(upperBound, preferredZone.center - preferredZone.clearance);
          }
        }
      }

      bubbleZones.forEach((zone) => {
        if (preferredZone && zone.id === preferredZone.id) return;
        const dist = current - zone.center;
        if (Math.abs(dist) >= zone.clearance) return;
        if (dist >= 0) {
          lowerBound = Math.max(lowerBound, zone.center + zone.clearance);
        } else {
          upperBound = Math.min(upperBound, zone.center - zone.clearance);
        }
      });

      if (lowerBound <= upperBound) {
        projected[i] = Math.max(lowerBound, Math.min(upperBound, current));
      } else {
        if (preferredDirection === 'down') {
          projected[i] = lowerBound;
        } else if (preferredDirection === 'up') {
          projected[i] = upperBound;
        } else {
          const toLower = Math.abs(current - lowerBound);
          const toUpper = Math.abs(current - upperBound);
          projected[i] = toLower <= toUpper ? lowerBound : upperBound;
        }
      }
    }

    for (let i = 1; i < projected.length; i += 1) {
      const minPos = projected[i - 1] + TIME_POINT_MIN_GAP;
      if (projected[i] < minPos) projected[i] = minPos;
    }
    for (let i = projected.length - 2; i >= 0; i -= 1) {
      const maxPos = projected[i + 1] - TIME_POINT_MIN_GAP;
      if (projected[i] > maxPos) projected[i] = maxPos;
    }

    if (projected[0] < 0) {
      const delta = -projected[0];
      for (let i = 0; i < projected.length; i += 1) projected[i] += delta;
    }
    const last = projected.length - 1;
    if (last >= 0 && projected[last] > 1) {
      const delta = projected[last] - 1;
      for (let i = 0; i < projected.length; i += 1) projected[i] -= delta;
    }
  }

  const nextPoints = points.map((point, index) => ({
    ...point,
    position: Math.max(0, Math.min(1, projected[index]))
  }));

  const deltas = new Map<string, number>();
  nextPoints.forEach((point, index) => {
    const delta = point.position - points[index].position;
    if (Math.abs(delta) > 0.000001) {
      deltas.set(point.id, delta);
    }
  });

  return { nextPoints, deltas };
}

function alignConnectedPoints(
  originalPoints: TimePoint[],
  candidatePoints: TimePoint[],
  connections: TimePointConnection[]
): TimePoint[] {
  const originalById = new Map(originalPoints.map((point) => [point.id, point]));
  const nextById = new Map(candidatePoints.map((point) => [point.id, point]));
  const adjacency = new Map<string, string[]>();

  const ensure = (id: string) => {
    if (!adjacency.has(id)) adjacency.set(id, []);
  };

  candidatePoints.forEach((point) => ensure(point.id));
  connections.forEach((connection) => {
    if (!nextById.has(connection.from_point_id) || !nextById.has(connection.to_point_id)) return;
    ensure(connection.from_point_id);
    ensure(connection.to_point_id);
    adjacency.get(connection.from_point_id)?.push(connection.to_point_id);
    adjacency.get(connection.to_point_id)?.push(connection.from_point_id);
  });

  const visited = new Set<string>();
  const adjusted = new Map<string, number>();

  adjacency.forEach((_neighbors, id) => {
    if (visited.has(id)) return;
    const queue = [id];
    const component: string[] = [];
    visited.add(id);

    while (queue.length > 0) {
      const current = queue.shift() as string;
      component.push(current);
      const neighbors = adjacency.get(current) ?? [];
      neighbors.forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }

    const movedDeltas: number[] = [];
    let componentMinDelta = -Infinity;
    let componentMaxDelta = Infinity;
    component.forEach((pointId) => {
      const prev = originalById.get(pointId);
      const next = nextById.get(pointId);
      if (!prev || !next) return;
      const delta = next.position - prev.position;
      if (Math.abs(delta) > 0.000001) {
        movedDeltas.push(delta);
      }
      componentMinDelta = Math.max(componentMinDelta, -prev.position);
      componentMaxDelta = Math.min(componentMaxDelta, 1 - prev.position);
    });

    if (movedDeltas.length === 0) return;

    // Preserve the strongest requested escape shift so linked points clear overlaps together.
    let targetDelta = movedDeltas[0];
    movedDeltas.forEach((delta) => {
      if (Math.abs(delta) > Math.abs(targetDelta)) {
        targetDelta = delta;
      }
    });

    const clampedDelta = Math.max(componentMinDelta, Math.min(componentMaxDelta, targetDelta));
    component.forEach((pointId) => {
      const prev = originalById.get(pointId);
      if (!prev) return;
      adjusted.set(pointId, prev.position + clampedDelta);
    });
  });

  return candidatePoints
    .map((point) => {
      const aligned = adjusted.get(point.id);
      return aligned == null ? point : { ...point, position: aligned };
    })
    .sort((a, b) => a.position - b.position);
}

function enforceComponentPointClearance(
  points: TimePoint[],
  connections: TimePointConnection[],
  zones: BubbleZone[],
  preferredBubbleId?: string
): TimePoint[] {
  if (points.length === 0 || zones.length === 0) return points;

  const next = points.map((point) => ({ ...point }));
  const byId = new Map(next.map((point) => [point.id, point]));
  const adjacency = new Map<string, string[]>();
  next.forEach((point) => adjacency.set(point.id, []));

  connections.forEach((connection) => {
    if (!byId.has(connection.from_point_id) || !byId.has(connection.to_point_id)) return;
    adjacency.get(connection.from_point_id)?.push(connection.to_point_id);
    adjacency.get(connection.to_point_id)?.push(connection.from_point_id);
  });

  const componentByPointId = new Map<string, string[]>();
  const visited = new Set<string>();
  next.forEach((point) => {
    if (visited.has(point.id)) return;
    const queue = [point.id];
    const component: string[] = [];
    visited.add(point.id);

    while (queue.length > 0) {
      const current = queue.shift() as string;
      component.push(current);
      (adjacency.get(current) ?? []).forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }

    component.forEach((id) => componentByPointId.set(id, component));
  });

  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;

    for (let i = 0; i < next.length; i += 1) {
      const point = next[i];
      const component = componentByPointId.get(point.id) ?? [point.id];

      const overlappingZone = zones
        .filter((zone) => zone.timeline_id === point.timeline_id)
        .map((zone) => {
          const dist = point.position - zone.center;
          const penetration = zone.clearance - Math.abs(dist);
          return { zone, dist, penetration };
        })
        .filter((entry) => entry.penetration > 0)
        .sort((a, b) => b.penetration - a.penetration)[0];

      if (!overlappingZone) continue;

      const { zone, dist, penetration } = overlappingZone;
      let direction = dist >= 0 ? 1 : -1;
      if (Math.abs(dist) < 0.000001 && zone.id === preferredBubbleId) {
        direction = 1;
      }
      const requestedShift = direction * (penetration + TIME_POINT_MIN_GAP);

      let minShift = -Infinity;
      let maxShift = Infinity;
      component.forEach((id) => {
        const member = byId.get(id);
        if (!member) return;
        minShift = Math.max(minShift, -member.position);
        maxShift = Math.min(maxShift, 1 - member.position);
      });
      const clampedShift = Math.max(minShift, Math.min(maxShift, requestedShift));
      if (Math.abs(clampedShift) < 0.000001) continue;

      component.forEach((id) => {
        const member = byId.get(id);
        if (!member) return;
        member.position = Math.max(0, Math.min(1, member.position + clampedShift));
      });
      moved = true;
    }

    if (!moved) break;
  }

  return next.sort((a, b) => a.position - b.position);
}

function resolveTimelineBubbleCollisions(
  timelineEvents: TimelineBubbleEvent[],
  movingEventId: string,
  _previousPosition: number,
  nextPosition: number,
  points: TimePoint[],
  sideLockById?: Map<string, 'above' | 'below'>
): TimelineBubbleEvent[] {
  const moving = timelineEvents.find((item) => item.id === movingEventId);
  if (!moving) return timelineEvents;

  const pointsById = new Map(points.map((point) => [point.id, point]));
  const desired = Math.max(0, Math.min(1, nextPosition));

  // Treat bubble movement like list insertion: neighbors shift by one slot, not runaway pushing.
  const ordered = [...timelineEvents].sort(
    (a, b) => bubblePosition(a, pointsById) - bubblePosition(b, pointsById)
  );
  const slotPositions = ordered.map((item) => bubblePosition(item, pointsById));
  const movingIndex = ordered.findIndex((item) => item.id === movingEventId);
  if (movingIndex < 0) return timelineEvents;

  const withoutMoving = ordered.filter((item) => item.id !== movingEventId);
  const insertIndex = withoutMoving.findIndex((item) => bubblePosition(item, pointsById) > desired);
  const nextIndex = insertIndex < 0 ? withoutMoving.length : insertIndex;
  const reordered = [...withoutMoving];
  reordered.splice(nextIndex, 0, moving);

  const assigned = reordered.map((item, index) => ({
    event: item,
    pos: item.id === movingEventId ? desired : slotPositions[index]
  }));

  const movingAssignedIndex = assigned.findIndex((item) => item.event.id === movingEventId);
  if (movingAssignedIndex < 0) return timelineEvents;

  const boundsById = new Map<string, { min: number; max: number }>(
    assigned.map((entry) => {
      if (entry.event.id === movingEventId) {
        // Direct user drag can cross scope; only auto-moved neighbors are side-constrained.
        return [entry.event.id, { min: 0, max: 1 }] as const;
      }

      const lock = sideLockById?.get(entry.event.id);
      if (!lock) {
        return [entry.event.id, eventScopeBounds(entry.event, points)] as const;
      }

      const proxyEvent: TimelineBubbleEvent = {
        ...entry.event,
        offset: lock === 'above' ? -Math.abs(entry.event.offset || BASE_MIN_GAP) : Math.abs(entry.event.offset || BASE_MIN_GAP)
      };
      return [entry.event.id, eventScopeBounds(proxyEvent, points)] as const;
    })
  );

  // Iterative solver: keep spacing, but never push non-dragged bubbles outside their scope.
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < assigned.length; i += 1) {
      const bounds = boundsById.get(assigned[i].event.id) ?? { min: 0, max: 1 };
      assigned[i].pos = Math.max(bounds.min, Math.min(bounds.max, assigned[i].pos));
    }

    for (let i = 1; i < assigned.length; i += 1) {
      const minPos = assigned[i - 1].pos + requiredGap(assigned[i - 1].event, assigned[i].event);
      if (assigned[i].pos < minPos) {
        assigned[i].pos = minPos;
      }
    }

    for (let i = assigned.length - 2; i >= 0; i -= 1) {
      const maxPos = assigned[i + 1].pos - requiredGap(assigned[i].event, assigned[i + 1].event);
      if (assigned[i].pos > maxPos) {
        assigned[i].pos = maxPos;
      }
    }
  }

  // Final placement for dragged bubble: nearest feasible slot if borders constrain neighbors.
  const movingBounds = boundsById.get(movingEventId) ?? { min: 0, max: 1 };
  const prev = movingAssignedIndex > 0 ? assigned[movingAssignedIndex - 1] : null;
  const next = movingAssignedIndex < assigned.length - 1 ? assigned[movingAssignedIndex + 1] : null;
  const minAllowed = prev
    ? prev.pos + requiredGap(prev.event, assigned[movingAssignedIndex].event)
    : movingBounds.min;
  const maxAllowed = next
    ? next.pos - requiredGap(assigned[movingAssignedIndex].event, next.event)
    : movingBounds.max;
  const clampedMin = Math.max(movingBounds.min, minAllowed);
  const clampedMax = Math.min(movingBounds.max, maxAllowed);

  if (clampedMin <= clampedMax) {
    assigned[movingAssignedIndex].pos = Math.max(clampedMin, Math.min(clampedMax, desired));
  } else {
    // No room at desired slot: snap to closest side of the constrained neighbor region.
    const toMin = Math.abs(desired - clampedMin);
    const toMax = Math.abs(desired - clampedMax);
    assigned[movingAssignedIndex].pos = toMin <= toMax ? clampedMin : clampedMax;
  }

  // Re-stabilize once after moving bubble snap.
  for (let i = 1; i < assigned.length; i += 1) {
    const minPos = assigned[i - 1].pos + requiredGap(assigned[i - 1].event, assigned[i].event);
    if (assigned[i].pos < minPos) {
      assigned[i].pos = minPos;
    }
  }
  for (let i = assigned.length - 2; i >= 0; i -= 1) {
    const maxPos = assigned[i + 1].pos - requiredGap(assigned[i].event, assigned[i + 1].event);
    if (assigned[i].pos > maxPos) {
      assigned[i].pos = maxPos;
    }
  }

  const nextById = new Map<string, TimelineBubbleEvent>();
  assigned.forEach((entry) => {
    nextById.set(entry.event.id, anchoredBubblePosition(entry.event, entry.pos, pointsById, points));
  });

  return timelineEvents.map((event) => nextById.get(event.id) ?? event);
}

export const useNovelStore = create<NovelStore>()(
  persist(
    (set, get) => ({
      novels: [],
      currentNovel: null,
      timelines: [],
      events: [],
      selectedCursor: null,
      overlappingEvents: [],
      undo_history: [],
      undo_index: -1,
      searchQuery: '',
      timePointsByNovel: {},
      timePointConnectionsByNovel: {},
      bubbleEventsByNovel: {},
      eventDependenciesByNovel: {},
      timelineColumnWidthsByNovel: {},

      initialize: async () => {
        const novels: Novel[] = await window.novelic.novels.list();
        const persistedNovelId = get().currentNovel?.id;
        if (novels.length === 0) {
          set({
            novels: [],
            currentNovel: null,
            timelines: [],
            events: [],
            timePointsByNovel: {},
            timePointConnectionsByNovel: {},
            bubbleEventsByNovel: {},
            eventDependenciesByNovel: {}
          });
          return;
        }

        const selected = novels.find((novel: Novel) => novel.id === persistedNovelId) ?? novels[0];
        set({ novels });
        await get().selectNovel(selected.id);
      },

      createNovel: async (name: string) => {
        const created = await window.novelic.novels.create({ name });
        const novels = await window.novelic.novels.list();
        set({ novels });
        await get().selectNovel(created.id);
      },

      selectNovel: async (novelId: string) => {
        const payload: NovelPayload = await window.novelic.novels.getPayload(novelId);
        set({
          currentNovel: payload.novel,
          timelines: payload.timelines,
          events: payload.events,
          selectedCursor: null,
          overlappingEvents: [],
          undo_history: [snapshotFromPayload(payload)],
          undo_index: 0
        });
      },

      createTimeline: async (name, color) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.timelines.create({ novel_id: currentNovel.id, name, color });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({
          timelines: payload.timelines,
          events: payload.events,
          undo_history: bounded,
          undo_index: bounded.length - 1
        });
        await pushSnapshotToDb(snapshot);
      },

      updateTimelineColor: async (timelineId, color) => {
        const { currentNovel, timelines } = get();
        if (!currentNovel) return;

        const timeline = timelines.find((item) => item.id === timelineId);
        if (!timeline) return;

        await window.novelic.timelines.update({ ...timeline, color });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        set({ timelines: payload.timelines, events: payload.events });
      },

      updateTimelineName: async (timelineId, name) => {
        const { currentNovel, timelines } = get();
        if (!currentNovel) return;
        const trimmed = name.trim();
        if (!trimmed) return;

        const timeline = timelines.find((item) => item.id === timelineId);
        if (!timeline) return;

        await window.novelic.timelines.update({ ...timeline, name: trimmed });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        set({ timelines: payload.timelines, events: payload.events });
      },

      createEvent: async (input) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.events.create({ ...input, novel_id: currentNovel.id });
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
        await pushSnapshotToDb(snapshot);
      },

      updateEvent: async (input) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.events.update(input);
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
        await pushSnapshotToDb(snapshot);
      },

      deleteEvent: async (eventId) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.events.delete(eventId);
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({ timelines: payload.timelines, events: payload.events, undo_history: bounded, undo_index: bounded.length - 1 });
        await pushSnapshotToDb(snapshot);
      },

      deleteTimeline: async (timelineId) => {
        const { currentNovel } = get();
        if (!currentNovel) return;

        await window.novelic.timelines.delete(timelineId);
        const payload: NovelPayload = await window.novelic.novels.getPayload(currentNovel.id);
        const state = get();
        const snapshot = snapshotFromPayload(payload);
        const bounded = appendHistory(state.undo_history, state.undo_index, snapshot);

        set({
          timelines: payload.timelines,
          events: payload.events,
          undo_history: bounded,
          undo_index: bounded.length - 1
        });
        await pushSnapshotToDb(snapshot);
      },

      setCursor: async (cursorIso) => {
        const { currentNovel } = get();
        if (!currentNovel || !cursorIso) {
          set({ selectedCursor: cursorIso, overlappingEvents: [] });
          return;
        }

        const overlaps = await window.novelic.events.getOverlapping(currentNovel.id, cursorIso);
        set({ selectedCursor: cursorIso, overlappingEvents: overlaps });
      },

      setSearchQuery: (query) => set({ searchQuery: query }),

      undo: async () => {
        const { undo_index, undo_history, currentNovel } = get();
        if (!currentNovel || undo_index <= 0) return;

        const nextIndex = undo_index - 1;
        const snapshot = undo_history[nextIndex];
        const payload: NovelPayload = {
          novel: snapshot.novel,
          timelines: snapshot.timelines,
          events: snapshot.events
        };

        await window.novelic.state.replacePayload(payload);
        set({
          currentNovel: payload.novel,
          timelines: payload.timelines,
          events: payload.events,
          undo_index: nextIndex
        });
      },

      redo: async () => {
        const { undo_index, undo_history, currentNovel } = get();
        if (!currentNovel || undo_index >= undo_history.length - 1) return;

        const nextIndex = undo_index + 1;
        const snapshot = undo_history[nextIndex];
        const payload: NovelPayload = {
          novel: snapshot.novel,
          timelines: snapshot.timelines,
          events: snapshot.events
        };

        await window.novelic.state.replacePayload(payload);

        set({
          currentNovel: payload.novel,
          timelines: payload.timelines,
          events: payload.events,
          undo_index: nextIndex
        });
      },

      exportNovelJson: async () => {
        const novel = get().currentNovel;
        if (!novel) return;
        await window.novelic.state.exportNovelJson(novel.id);
      },

      exportTimelineCsv: async (timelineId) => {
        const novel = get().currentNovel;
        if (!novel) return;
        await window.novelic.state.exportTimelineCsv(novel.id, timelineId);
      },

      importNovelJson: async () => {
        const result = await window.novelic.state.importNovelJson();
        if (result?.canceled || !result?.novelId) return;
        const novels = await window.novelic.novels.list();
        set({ novels });
        await get().selectNovel(result.novelId);
      },

      addTimePoint: (label, position, timelineId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const point: TimePoint = {
          id: uuidv4(),
          label: label.trim(),
          position: Math.max(0, Math.min(1, position)),
          timeline_id: timelineId
        };
        const next = [...existing, point].sort((a, b) => a.position - b.position);
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          }
        });
      },

      updateTimePoint: (id, label) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const next = existing.map((point) => (point.id === id ? { ...point, label: label.trim() } : point));
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          }
        });
      },

      updateTimePointPosition: (id, position) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const clamped = Math.max(0, Math.min(1, position));
        const connections = get().timePointConnectionsByNovel[novelId] ?? [];

        // Move all points in the connected component so linked points stay horizontally aligned.
        const linkedIds = new Set<string>([id]);
        const queue: string[] = [id];
        while (queue.length > 0) {
          const current = queue.shift() as string;
          connections.forEach((connection) => {
            const neighbor =
              connection.from_point_id === current
                ? connection.to_point_id
                : connection.to_point_id === current
                  ? connection.from_point_id
                  : null;
            if (neighbor && !linkedIds.has(neighbor)) {
              linkedIds.add(neighbor);
              queue.push(neighbor);
            }
          });
        }

        const next = existing
          .map((point) => (linkedIds.has(point.id) ? { ...point, position: clamped } : point))
          .sort((a, b) => a.position - b.position);
        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          }
        });
      },

      deleteTimePoint: (id) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const existing = get().timePointsByNovel[novelId] ?? [];
        const next = existing.filter((point) => point.id !== id);
        const connections = get().timePointConnectionsByNovel[novelId] ?? [];
        const nextConnections = connections.filter(
          (connection) => connection.from_point_id !== id && connection.to_point_id !== id
        );

        const bubbleEvents = get().bubbleEventsByNovel[novelId] ?? [];
        const reanchoredEvents = bubbleEvents
          .map((event) => {
            if (event.anchor_point_id !== id) return event;
            const nextAnchor = selectAnchorPoint(next, event.timeline_id, event.offset);
            if (!nextAnchor) return null;
            return {
              ...event,
              anchor_point_id: nextAnchor.id,
              offset: event.offset
            };
          })
          .filter((event): event is TimelineBubbleEvent => event !== null);

        const remainingEventIds = new Set(reanchoredEvents.map((event) => event.id));
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const nextDeps = deps.filter(
          (dep) => remainingEventIds.has(dep.from_event_id) && remainingEventIds.has(dep.to_event_id)
        );

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: next
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [novelId]: nextConnections
          },
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: reanchoredEvents
          },
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
      },

      addTimePointConnection: (fromPointId, toPointId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId || fromPointId === toPointId) return;

        const points = get().timePointsByNovel[novelId] ?? [];
        const from = points.find((point) => point.id === fromPointId);
        const to = points.find((point) => point.id === toPointId);
        if (!from || !to || from.timeline_id === to.timeline_id) return;

        const existing = get().timePointConnectionsByNovel[novelId] ?? [];
        const alreadyExists = existing.some(
          (connection) =>
            (connection.from_point_id === fromPointId && connection.to_point_id === toPointId) ||
            (connection.from_point_id === toPointId && connection.to_point_id === fromPointId)
        );
        if (alreadyExists) return;

        const nextConnections: TimePointConnection[] = [
          ...existing,
          {
            id: uuidv4(),
            from_point_id: fromPointId,
            to_point_id: toPointId
          }
        ];

        // Snap linked points to the same vertical position at the moment they are connected.
        const alignedPosition = from.position;
        const nextPoints = points
          .map((point) =>
            point.id === fromPointId || point.id === toPointId
              ? { ...point, position: alignedPosition }
              : point
          )
          .sort((a, b) => a.position - b.position);

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: nextPoints
          },
          timePointConnectionsByNovel: {
            ...get().timePointConnectionsByNovel,
            [novelId]: nextConnections
          }
        });
      },

      addBubbleEvent: (title, timelineId, preferredPosition) => {
        const novelId = get().currentNovel?.id;
        if (!novelId || !title.trim()) return false;

        const points = get().timePointsByNovel[novelId] ?? [];
        const anchor = selectAnchorPoint(points, timelineId, preferredPosition);
        if (!anchor) return false;

        const existing = get().bubbleEventsByNovel[novelId] ?? [];
        const sameTimelineCount = existing.filter((event) => event.timeline_id === timelineId).length;
        const offset = preferredPosition - anchor.position;
        const next: TimelineBubbleEvent[] = [
          ...existing,
          {
            id: uuidv4(),
            timeline_id: timelineId,
            anchor_point_id: anchor.id,
            title: title.trim(),
            side: sameTimelineCount % 2 === 0 ? 'right' : 'left',
            offset
          }
        ];

        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
        return true;
      },

      updateBubbleEventTitle: (eventId, title) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const existing = get().bubbleEventsByNovel[novelId] ?? [];
        const next = existing.map((event) => (event.id === eventId ? { ...event, title: trimmed } : event));
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
      },

      moveBubbleEvent: (eventId, nextPosition) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return false;

        const points = get().timePointsByNovel[novelId] ?? [];
        const bubbles = get().bubbleEventsByNovel[novelId] ?? [];
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const target = bubbles.find((event) => event.id === eventId);
        if (!target) return false;

        if (!selectAnchorPoint(points, target.timeline_id, nextPosition)) return false;

        const pointsById = new Map(points.map((point) => [point.id, point]));
        const clamped = Math.max(0, Math.min(1, nextPosition));
        if (!canMoveBubbleEvent(target, clamped, bubbles, deps, pointsById)) return false;

        const next = bubbles.map((event) =>
          event.id === eventId
            ? desiredBubblePosition(event, clamped, points)
            : event
        );

        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
        return true;
      },

      settleBubbleEventPosition: (eventId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return false;

        const points = get().timePointsByNovel[novelId] ?? [];
        const bubbles = get().bubbleEventsByNovel[novelId] ?? [];
        const target = bubbles.find((event) => event.id === eventId);
        if (!target) return false;

        const pointsById = new Map(points.map((point) => [point.id, point]));
        const currentPosition = bubblePosition(target, pointsById);
        const sameTimeline = bubbles.filter((event) => event.timeline_id === target.timeline_id);
        const untouched = bubbles.filter((event) => event.timeline_id !== target.timeline_id);
        const sideLockById = new Map<string, 'above' | 'below'>(
          sameTimeline
            .filter((event) => event.id !== eventId)
            .map((event) => [event.id, event.offset < 0 ? 'above' : 'below'])
        );
        const resolved = resolveTimelineBubbleCollisions(
          sameTimeline,
          eventId,
          currentPosition,
          currentPosition,
          points,
          sideLockById
        );
        const resolvedZones: BubbleZone[] = resolved.map((event) => ({
          id: event.id,
          timeline_id: event.timeline_id,
          center: bubblePosition(event, pointsById),
          clearance: pointClearance(event)
        }));
        const timelinePoints = points.filter((point) => point.timeline_id === target.timeline_id);
        const { nextPoints: shiftedTimelinePoints } = slideTimelinePointsFromBubbles(
          timelinePoints,
          resolved,
          eventId,
          currentPosition
        );

        const shiftedPointById = new Map(shiftedTimelinePoints.map((point) => [point.id, point]));
        const candidatePoints = points.map((point) => shiftedPointById.get(point.id) ?? point);
        const connections = get().timePointConnectionsByNovel[novelId] ?? [];
        const alignedPoints = alignConnectedPoints(points, candidatePoints, connections);
        const nextPoints = enforceComponentPointClearance(
          alignedPoints,
          connections,
          resolvedZones,
          eventId
        );

        const finalById = new Map(nextPoints.map((point) => [point.id, point]));
        const finalDeltas = new Map<string, number>();
        points.forEach((point) => {
          const moved = finalById.get(point.id);
          if (!moved) return;
          const delta = moved.position - point.position;
          if (Math.abs(delta) > 0.000001) {
            finalDeltas.set(point.id, delta);
          }
        });

        const compensatedResolved = resolved.map((event) => {
          const delta = finalDeltas.get(event.anchor_point_id);
          if (!delta) return event;
          return {
            ...event,
            offset: event.offset - delta
          };
        });

        const finalPointsById = new Map(nextPoints.map((point) => [point.id, point]));
        const scopeClampedResolved = compensatedResolved.map((event) => {
          if (event.id === eventId) return event;
          const lock = sideLockById.get(event.id);
          const proxyEvent =
            lock == null
              ? event
              : {
                  ...event,
                  offset: lock === 'above' ? -Math.abs(event.offset || BASE_MIN_GAP) : Math.abs(event.offset || BASE_MIN_GAP)
                };
          const bounds = eventScopeBounds(proxyEvent, nextPoints);
          const currentPos = bubblePosition(event, finalPointsById);
          const clampedPos = Math.max(bounds.min, Math.min(bounds.max, currentPos));
          if (Math.abs(clampedPos - currentPos) < 0.000001) return event;
          return anchoredBubblePosition(event, clampedPos, finalPointsById, nextPoints);
        });

        const movingAfterClamp = scopeClampedResolved.find((event) => event.id === eventId);
        if (!movingAfterClamp) return false;
        const stabilizedResolved = resolveTimelineBubbleCollisions(
          scopeClampedResolved,
          eventId,
          currentPosition,
          currentPosition,
          nextPoints,
          sideLockById
        );

        const stabilizedPointsById = new Map(nextPoints.map((point) => [point.id, point]));
        const stabilizedZones: BubbleZone[] = stabilizedResolved.map((event) => ({
          id: event.id,
          timeline_id: event.timeline_id,
          center: bubblePosition(event, stabilizedPointsById),
          clearance: pointClearance(event)
        }));

        const clearedPoints = enforceComponentPointClearance(
          nextPoints,
          connections,
          stabilizedZones,
          eventId
        );

        const nextPointsById = new Map(nextPoints.map((point) => [point.id, point]));
        const clearedPointsById = new Map(clearedPoints.map((point) => [point.id, point]));
        const finalizedResolved = stabilizedResolved.map((event) => {
          const before = nextPointsById.get(event.anchor_point_id);
          const after = clearedPointsById.get(event.anchor_point_id);
          if (!before || !after) return event;
          const delta = after.position - before.position;
          if (Math.abs(delta) < 0.000001) return event;
          return {
            ...event,
            offset: event.offset - delta
          };
        });

        const next = [...untouched, ...finalizedResolved];

        set({
          timePointsByNovel: {
            ...get().timePointsByNovel,
            [novelId]: clearedPoints
          },
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: next
          }
        });
        return true;
      },

      deleteBubbleEvent: (eventId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const events = get().bubbleEventsByNovel[novelId] ?? [];
        const nextEvents = events.filter((event) => event.id !== eventId);
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const nextDeps = deps.filter((dep) => dep.from_event_id !== eventId && dep.to_event_id !== eventId);
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: nextEvents
          },
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
      },

      addEventDependency: (fromEventId, toEventId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId || fromEventId === toEventId) return false;

        const events = get().bubbleEventsByNovel[novelId] ?? [];
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const from = events.find((event) => event.id === fromEventId);
        const to = events.find((event) => event.id === toEventId);
        if (!from || !to || from.timeline_id !== to.timeline_id) return false;

        const exists = deps.some(
          (dep) => dep.from_event_id === fromEventId && dep.to_event_id === toEventId
        );
        if (exists) return true;

        const points = get().timePointsByNovel[novelId] ?? [];
        const pointsById = new Map(points.map((point) => [point.id, point]));
        const fromPos = bubblePosition(from, pointsById);
        const toPos = bubblePosition(to, pointsById);
        const orderedFrom = fromPos <= toPos ? from : to;
        const orderedTo = fromPos <= toPos ? to : from;

        const nextDeps: TimelineEventDependency[] = [
          ...deps,
          {
            id: uuidv4(),
            timeline_id: orderedFrom.timeline_id,
            from_event_id: orderedFrom.id,
            to_event_id: orderedTo.id
          }
        ];

        set({
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
        return true;
      },

      deleteEventDependency: (dependencyId) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const deps = get().eventDependenciesByNovel[novelId] ?? [];
        const nextDeps = deps.filter((dep) => dep.id !== dependencyId);
        set({
          eventDependenciesByNovel: {
            ...get().eventDependenciesByNovel,
            [novelId]: nextDeps
          }
        });
      },

      setBubbleEventSide: (eventId, side) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const events = get().bubbleEventsByNovel[novelId] ?? [];
        const nextEvents = events.map((event) => (event.id === eventId ? { ...event, side } : event));
        set({
          bubbleEventsByNovel: {
            ...get().bubbleEventsByNovel,
            [novelId]: nextEvents
          }
        });
      },

      setTimelineColumnWidth: (timelineId, width) => {
        const novelId = get().currentNovel?.id;
        if (!novelId) return;
        const clamped = Math.max(150, Math.min(480, Math.round(width)));
        const existing = get().timelineColumnWidthsByNovel[novelId] ?? {};
        set({
          timelineColumnWidthsByNovel: {
            ...get().timelineColumnWidthsByNovel,
            [novelId]: {
              ...existing,
              [timelineId]: clamped
            }
          }
        });
      },

      reorderTimelines: async (sourceTimelineId, targetTimelineId, dropPosition) => {
        if (sourceTimelineId === targetTimelineId) return;
        const { timelines } = get();
        const sourceIndex = timelines.findIndex((item) => item.id === sourceTimelineId);
        if (sourceIndex < 0) return;

        const withoutSource = [...timelines];
        const [moved] = withoutSource.splice(sourceIndex, 1);
        const targetIndex = withoutSource.findIndex((item) => item.id === targetTimelineId);
        if (!moved || targetIndex < 0) return;

        const insertIndex = targetIndex + (dropPosition === 'after' ? 1 : 0);
        const reordered = [...withoutSource];
        reordered.splice(insertIndex, 0, moved);

        const nextTimelines = reordered.map((timeline, index) => ({
          ...timeline,
          order_index: index
        }));

        set({ timelines: nextTimelines });
        await Promise.all(nextTimelines.map((timeline) => window.novelic.timelines.update(timeline)));
      }
    }),
    {
      name: 'novelic-ui-cache',
      partialize: (state) => ({
        currentNovel: state.currentNovel,
        selectedCursor: state.selectedCursor,
        searchQuery: state.searchQuery,
        timePointsByNovel: state.timePointsByNovel,
        timePointConnectionsByNovel: state.timePointConnectionsByNovel,
        bubbleEventsByNovel: state.bubbleEventsByNovel,
        eventDependenciesByNovel: state.eventDependenciesByNovel,
        timelineColumnWidthsByNovel: state.timelineColumnWidthsByNovel
      })
    }
  )
);

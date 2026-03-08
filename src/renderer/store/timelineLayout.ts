export interface TimePoint {
  id: string;
  label: string;
  position: number;
  timeline_id: string;
}

export interface TimePointConnection {
  id: string;
  from_point_id: string;
  to_point_id: string;
}

export type BubbleSide = 'left' | 'right';

export interface TimelineBubbleEvent {
  id: string;
  timeline_id: string;
  anchor_point_id: string;
  title: string;
  side: BubbleSide;
  offset: number;
}

export interface TimelineEventDependency {
  id: string;
  timeline_id: string;
  from_event_id: string;
  to_event_id: string;
}

export interface BubbleZone {
  id: string;
  timeline_id: string;
  center: number;
  clearance: number;
}

const AXIS_HEIGHT_PX = 720;
export const BASE_MIN_GAP = 0.01875;
const BUBBLE_MIN_HEIGHT_PX = 24;
const BUBBLE_BORDER_PX = 4;
const BUBBLE_VERTICAL_PADDING_PX = 7;
const BUBBLE_LINE_HEIGHT_PX = 14;
const BUBBLE_CHARS_PER_LINE = 24;
const BUBBLE_VISIBLE_EDGE_GAP_PX = 6;
const TIME_POINT_RADIUS_PX = 9;
const TIME_POINT_VISIBLE_GAP_PX = 4;
const TIME_POINT_MIN_GAP = 0.005;

function clampPosition(value: number, maxPosition: number): number {
  return Math.max(0, Math.min(maxPosition, value));
}

export function selectAnchorPoint(
  points: TimePoint[],
  timelineId: string,
  preferredPosition: number
): TimePoint | null {
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

export function bubblePosition(event: TimelineBubbleEvent, pointsById: Map<string, TimePoint>): number {
  const anchor = pointsById.get(event.anchor_point_id);
  if (!anchor) return 0;
  return anchor.position + event.offset;
}

export function canMoveBubbleEvent(
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

export function desiredBubblePosition(
  event: TimelineBubbleEvent,
  desiredPosition: number,
  points: TimePoint[],
  maxPosition = 1
): TimelineBubbleEvent {
  const anchor = selectAnchorPoint(points, event.timeline_id, desiredPosition);
  if (!anchor) return event;
  const clamped = clampPosition(desiredPosition, maxPosition);
  return {
    ...event,
    anchor_point_id: anchor.id,
    offset: clamped - anchor.position
  };
}

export function anchoredBubblePosition(
  event: TimelineBubbleEvent,
  desiredPosition: number,
  pointsById: Map<string, TimePoint>,
  points: TimePoint[],
  maxPosition = 1
): TimelineBubbleEvent {
  const anchor = pointsById.get(event.anchor_point_id);
  const clamped = clampPosition(desiredPosition, maxPosition);
  if (!anchor) {
    return desiredBubblePosition(event, clamped, points, maxPosition);
  }
  return {
    ...event,
    offset: clamped - anchor.position
  };
}

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

export function pointClearance(event: TimelineBubbleEvent): number {
  const halfBubble = estimatedBubbleHeightPx(event.title) / 2;
  const px = halfBubble + TIME_POINT_RADIUS_PX + TIME_POINT_VISIBLE_GAP_PX;
  return Math.max(BASE_MIN_GAP, px / AXIS_HEIGHT_PX);
}

export function eventScopeBounds(
  event: TimelineBubbleEvent,
  points: TimePoint[],
  maxPosition = 1
): { min: number; max: number } {
  const timelinePoints = points
    .filter((point) => point.timeline_id === event.timeline_id)
    .sort((a, b) => a.position - b.position);

  const anchorIndex = timelinePoints.findIndex((point) => point.id === event.anchor_point_id);
  if (anchorIndex < 0) {
    return { min: 0, max: maxPosition };
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
  const max = nextPoint ? nextPoint.position - BASE_MIN_GAP : maxPosition;
  return { min, max: Math.max(min, max) };
}

export function slideTimelinePointsFromBubbles(
  timelinePoints: TimePoint[],
  timelineBubbles: TimelineBubbleEvent[],
  preferredBubbleId?: string,
  preferredBubbleCenter?: number,
  maxPosition = 1
): { nextPoints: TimePoint[]; deltas: Map<string, number> } {
  if (timelinePoints.length === 0 || timelineBubbles.length === 0) {
    return { nextPoints: timelinePoints, deltas: new Map<string, number>() };
  }

  const points = [...timelinePoints].sort((a, b) => a.position - b.position);
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
      let upperBound = maxPosition;
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
    if (last >= 0 && projected[last] > maxPosition) {
      const delta = projected[last] - maxPosition;
      for (let i = 0; i < projected.length; i += 1) projected[i] -= delta;
    }
  }

  const nextPoints = points.map((point, index) => ({
    ...point,
    position: clampPosition(projected[index], maxPosition)
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

export function alignConnectedPoints(
  originalPoints: TimePoint[],
  candidatePoints: TimePoint[],
  connections: TimePointConnection[],
  maxPosition = 1
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
      componentMaxDelta = Math.min(componentMaxDelta, maxPosition - prev.position);
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

export function enforceComponentPointClearance(
  points: TimePoint[],
  connections: TimePointConnection[],
  zones: BubbleZone[],
  preferredBubbleId?: string,
  maxPosition = 1
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
        maxShift = Math.min(maxShift, maxPosition - member.position);
      });
      const clampedShift = Math.max(minShift, Math.min(maxShift, requestedShift));
      if (Math.abs(clampedShift) < 0.000001) continue;

      component.forEach((id) => {
        const member = byId.get(id);
        if (!member) return;
        member.position = clampPosition(member.position + clampedShift, maxPosition);
      });
      moved = true;
    }

    if (!moved) break;
  }

  return next.sort((a, b) => a.position - b.position);
}

export function resolveTimelineBubbleCollisions(
  timelineEvents: TimelineBubbleEvent[],
  movingEventId: string,
  _previousPosition: number,
  nextPosition: number,
  points: TimePoint[],
  sideLockById?: Map<string, 'above' | 'below'>,
  maxPosition = 1
): TimelineBubbleEvent[] {
  const moving = timelineEvents.find((item) => item.id === movingEventId);
  if (!moving) return timelineEvents;

  const pointsById = new Map(points.map((point) => [point.id, point]));
  const desired = clampPosition(nextPosition, maxPosition);

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
        return [entry.event.id, { min: 0, max: maxPosition }] as const;
      }

      const lock = sideLockById?.get(entry.event.id);
      if (!lock) {
        return [entry.event.id, eventScopeBounds(entry.event, points, maxPosition)] as const;
      }

      const proxyEvent: TimelineBubbleEvent = {
        ...entry.event,
        offset:
          lock === 'above'
            ? -Math.abs(entry.event.offset || BASE_MIN_GAP)
            : Math.abs(entry.event.offset || BASE_MIN_GAP)
      };
      return [entry.event.id, eventScopeBounds(proxyEvent, points, maxPosition)] as const;
    })
  );

  // Iterative solver: keep spacing, but never push non-dragged bubbles outside their scope.
  for (let pass = 0; pass < 4; pass += 1) {
    for (let i = 0; i < assigned.length; i += 1) {
      const bounds = boundsById.get(assigned[i].event.id) ?? { min: 0, max: maxPosition };
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
  const movingBounds = boundsById.get(movingEventId) ?? { min: 0, max: maxPosition };
  const prev = movingAssignedIndex > 0 ? assigned[movingAssignedIndex - 1] : null;
  const next =
    movingAssignedIndex < assigned.length - 1 ? assigned[movingAssignedIndex + 1] : null;
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
    nextById.set(
      entry.event.id,
      anchoredBubblePosition(entry.event, entry.pos, pointsById, points, maxPosition)
    );
  });

  return timelineEvents.map((event) => nextById.get(event.id) ?? event);
}

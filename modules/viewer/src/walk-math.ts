import type { FlatModel } from '@flatwalk/contract';

/**
 * Movement over Geometry Core output. Collision segments are already the wall faces
 * (thickness folded in, passable doors cut out), so the player radius is the only margin applied here.
 * Stepping and point-in-polygon follow prototype/src/model.ts (movePlayer, contains); no geometry is derived.
 */

export type Point = [number, number];
export type Segment = { a: readonly [number, number]; b: readonly [number, number] };

export const PLAYER_RADIUS = 0.25;
const STEP = 0.06;

export function segmentDistance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function canStand(p: readonly [number, number], segments: readonly Segment[], radius: number): boolean {
  return !segments.some((segment) => segmentDistance(p, segment.a, segment.b) < radius);
}

/** Axis-separated sub-stepping lets the player slide along a wall instead of sticking to it. */
export function movePlayer(start: Point, delta: Point, segments: readonly Segment[], radius: number): Point {
  const steps = Math.max(1, Math.ceil(Math.hypot(delta[0], delta[1]) / STEP));
  let p: Point = [start[0], start[1]];
  for (let i = 0; i < steps; i++) {
    const x: Point = [p[0] + delta[0] / steps, p[1]];
    if (canStand(x, segments, radius)) p = x;
    const z: Point = [p[0], p[1] + delta[1] / steps];
    if (canStand(z, segments, radius)) p = z;
  }
  return p;
}

export function contains(p: readonly [number, number], points: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (segmentDistance(p, a, b) < 0.0001) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export type RoomPolygons = Record<string, readonly (readonly [number, number])[]>;

/** Collects the polygons Geometry Core can produce; rooms it cannot map are simply absent. */
export function roomPolygons(
  model: FlatModel,
  polygonOf: (model: FlatModel, roomId: string) => readonly (readonly [number, number])[] | null,
): RoomPolygons {
  const result: RoomPolygons = {};
  for (const roomId of Object.keys(model.rooms)) {
    try {
      const polygon = polygonOf(model, roomId);
      if (polygon && polygon.length >= 3) result[roomId] = polygon;
    } catch {
      // Reported by prepareWalk diagnostics; the room simply has no floor to stand on.
    }
  }
  return result;
}

export function roomAt(p: readonly [number, number], polygons: RoomPolygons): string | null {
  for (const [roomId, polygon] of Object.entries(polygons)) if (contains(p, polygon)) return roomId;
  return null;
}

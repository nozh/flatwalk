import type { FlatModel } from '@flatwalk/contract';

/** Plan coordinates from Contract: metres, x right, y down. */
export type Point = FlatModel['vertices'][string];

export const TOL = 0.01;

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function sub(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

export function add(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]];
}

export function scale(a: Point, s: number): Point {
  return [a[0] * s, a[1] * s];
}

export function dot(a: Point, b: Point) {
  return a[0] * b[0] + a[1] * b[1];
}

export function normalize(a: Point): Point {
  const len = Math.hypot(a[0], a[1]);
  if (len < 1e-12) return [0, 0];
  return [a[0] / len, a[1] / len];
}

export function signedArea(points: Point[]) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}

export function area(points: Point[]) {
  return Math.abs(signedArea(points));
}

export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-18) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function projectOnSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-18) return { t: 0, point: a, dist: distance(p, a), length: 0 };
  const length = Math.sqrt(len2);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2;
  const clamped = Math.max(0, Math.min(1, t));
  const point: Point = [a[0] + clamped * dx, a[1] + clamped * dz];
  return { t, point, dist: distance(p, point), length };
}

export function wallPoint(a: Point, b: Point, at: number): Point {
  const len = distance(a, b);
  if (len < 1e-12) return a;
  return [a[0] + (b[0] - a[0]) * at / len, a[1] + (b[1] - a[1]) * at / len];
}

/** Even-odd fill. Boundary (within 0.1 mm) is treated as inside for this helper. */
export function contains(p: Point, points: Point[], onBoundary = true) {
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (segmentDistance(p, points[i], points[j]) < 1e-4) return onBoundary;
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function onBoundary(p: Point, points: Point[], tol = TOL) {
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (segmentDistance(p, points[i], points[j]) < tol) return true;
  }
  return false;
}

export function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const o1 = cross(a, b, c);
  const o2 = cross(a, b, d);
  const o3 = cross(c, d, a);
  const o4 = cross(c, d, b);
  if (Math.abs(o1) < 1e-12 && Math.abs(o2) < 1e-12 && Math.abs(o3) < 1e-12) return false;
  return o1 * o2 < -1e-12 && o3 * o4 < -1e-12;
}

function cross(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

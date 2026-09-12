/** Plan (x right, y down) → three.js (x, 0, y) with Y up. */
export function planToWorld(x: number, y: number, height = 0): [number, number, number] {
  return [x, height, y];
}

export function distance(a: readonly [number, number], b: readonly [number, number]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

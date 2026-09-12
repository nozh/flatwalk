import type { FlatModel } from '@flatwalk/contract';

/**
 * First-screen illustration: the wall graph of a FlatModel drawn as an axonometric massing.
 * Presentation only — no faces, no areas, no collisions. Geometry Core and Builder stay the
 * single source for anything the Viewer measures or walks; this draws what Parser returned so
 * the entry screen shows the product's own output instead of a stock picture.
 */

export type MassingSegment = { kind: 'wall' | 'sill'; height: number; corners: [number, number][] };

export type Massing = {
  viewBox: [number, number, number, number];
  floor: [number, number][] | null;
  segments: MassingSegment[];
  entrance: [number, number] | null;
  /** Plan-space width and depth in metres, for the figure caption. */
  extent: { width: number; depth: number };
};

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
/** Vertical foreshortening: a true isometric rise makes a 2.8 m storey read like a tower at this scale. */
const RISE = 0.78;
const PADDING = 0.6;

type Point = [number, number];

export function project(x: number, y: number, z: number): Point {
  return [(x - y) * COS30, (x + y) * SIN30 - z * RISE];
}

/** Exterior walls of a well-formed flat make one closed ring; anything else gets no floor plate. */
export function exteriorRing(model: FlatModel): string[] | null {
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const ends = neighbours.get(from);
    if (ends) ends.push(to);
    else neighbours.set(from, [to]);
  };
  let exteriorWalls = 0;
  for (const wall of Object.values(model.walls)) {
    if (!wall.exterior) continue;
    if (!model.vertices[wall.a] || !model.vertices[wall.b]) return null;
    exteriorWalls += 1;
    link(wall.a, wall.b);
    link(wall.b, wall.a);
  }
  if (exteriorWalls < 3 || neighbours.size !== exteriorWalls) return null;
  for (const ends of neighbours.values()) if (ends.length !== 2) return null;

  const start = neighbours.keys().next().value as string;
  const ring = [start];
  let previous: string | null = null;
  let current = start;
  while (ring.length <= exteriorWalls) {
    const next = neighbours.get(current)!.find((end) => end !== previous) ?? null;
    if (next === null) return null;
    if (next === start) return ring.length === exteriorWalls ? ring : null;
    ring.push(next);
    previous = current;
    current = next;
  }
  return null;
}

/** Solid stretches and window parapets of one wall, in order along a → b. */
function wallSegments(model: FlatModel, wallId: string): MassingSegment[] {
  const wall = model.walls[wallId];
  const a = wall && model.vertices[wall.a];
  const b = wall && model.vertices[wall.b];
  if (!wall || !a || !b) return [];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length <= 0) return [];

  const ux = (b[0] - a[0]) / length;
  const uy = (b[1] - a[1]) / length;
  const half = wall.thickness / 2;
  const full = model.flat.defaults.wallHeight;
  const sill = model.flat.defaults.windowSill;

  const corners = (from: number, to: number): [number, number][] => [
    [a[0] + ux * from - uy * half, a[1] + uy * from + ux * half],
    [a[0] + ux * to - uy * half, a[1] + uy * to + ux * half],
    [a[0] + ux * to + uy * half, a[1] + uy * to - ux * half],
    [a[0] + ux * from + uy * half, a[1] + uy * from - ux * half],
  ];

  const holes = Object.values(model.openings)
    .filter((opening) => opening.wall === wallId)
    .map((opening) => ({
      from: Math.max(0, Math.min(length, opening.at)),
      to: Math.max(0, Math.min(length, opening.at + opening.width)),
      // A doorway is drawn as a gap and a window as a parapet, so both read without any label.
      height: opening.kind === 'door' ? 0 : Math.min(sill, full),
    }))
    .filter((hole) => hole.to > hole.from)
    .sort((left, right) => left.from - right.from);

  const segments: MassingSegment[] = [];
  let cursor = 0;
  for (const hole of holes) {
    if (hole.from > cursor) segments.push({ kind: 'wall', height: full, corners: corners(cursor, hole.from) });
    if (hole.to > cursor && hole.height > 0) {
      segments.push({ kind: 'sill', height: hole.height, corners: corners(Math.max(cursor, hole.from), hole.to) });
    }
    cursor = Math.max(cursor, hole.to);
  }
  if (cursor < length) segments.push({ kind: 'wall', height: full, corners: corners(cursor, length) });
  return segments;
}

function entrancePoint(model: FlatModel): Point | null {
  for (const opening of Object.values(model.openings)) {
    if (opening.kind !== 'door' || opening.entrance !== true) continue;
    const wall = model.walls[opening.wall];
    const a = wall && model.vertices[wall.a];
    const b = wall && model.vertices[wall.b];
    if (!wall || !a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= 0) continue;
    const at = Math.min(length, opening.at + opening.width / 2) / length;
    return [a[0] + (b[0] - a[0]) * at, a[1] + (b[1] - a[1]) * at];
  }
  return null;
}

export function buildMassing(model: FlatModel): Massing | null {
  const segments = Object.keys(model.walls).flatMap((wallId) => wallSegments(model, wallId));
  if (segments.length === 0) return null;

  // Painter's order: in this projection a larger x + y sits nearer the viewer, so it is drawn last.
  segments.sort((left, right) => depth(left.corners) - depth(right.corners));

  const ringIds = exteriorRing(model);
  const floor = ringIds ? ringIds.map((id) => model.vertices[id] as Point) : null;

  const xs: number[] = [];
  const ys: number[] = [];
  for (const segment of segments) {
    for (const [x, y] of segment.corners) {
      for (const z of [0, segment.height]) {
        const [px, py] = project(x, y, z);
        xs.push(px);
        ys.push(py);
      }
    }
  }
  const minX = Math.min(...xs) - PADDING;
  const minY = Math.min(...ys) - PADDING;
  const width = Math.max(...xs) + PADDING - minX;
  const height = Math.max(...ys) + PADDING - minY;

  const planXs = Object.values(model.vertices).map((point) => point[0]);
  const planYs = Object.values(model.vertices).map((point) => point[1]);

  return {
    viewBox: [minX, minY, width, height],
    floor,
    segments,
    entrance: entrancePoint(model),
    extent: {
      width: Math.max(...planXs) - Math.min(...planXs),
      depth: Math.max(...planYs) - Math.min(...planYs),
    },
  };
}

function depth(corners: [number, number][]): number {
  return corners.reduce((total, [x, y]) => total + x + y, 0) / corners.length;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function polygon(points: Point[], className: string, index: number): string {
  const path = points.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
  return `<polygon class="${className}" style="--face:${index}" points="${path}" />`;
}

/** Faces whose outward normal leans toward the viewer at (+x, +y); the rest stay hidden. */
function visibleSides(segment: MassingSegment, index: number): string {
  const [cx, cy] = segment.corners.reduce(
    ([x, y], [px, py]) => [x + px / 4, y + py / 4] as Point,
    [0, 0] as Point,
  );
  const faces: string[] = [];
  for (let i = 0; i < segment.corners.length; i += 1) {
    const from = segment.corners[i]!;
    const to = segment.corners[(i + 1) % segment.corners.length]!;
    const nx = (from[0] + to[0]) / 2 - cx;
    const ny = (from[1] + to[1]) / 2 - cy;
    if (nx + ny <= 1e-6) continue;
    const tone = Math.abs(nx) >= Math.abs(ny) ? 'hero-face-right' : 'hero-face-left';
    faces.push(polygon([
      project(from[0], from[1], 0),
      project(to[0], to[1], 0),
      project(to[0], to[1], segment.height),
      project(from[0], from[1], segment.height),
    ], tone, index));
  }
  return faces.join('');
}

export type MassingOptions = { title?: string };

export function renderMassingSvg(massing: Massing, options: MassingOptions = {}): string {
  const [vx, vy, vw, vh] = massing.viewBox;
  const unit = Math.max(vw, vh);

  const floor = massing.floor
    ? polygon(massing.floor.map(([x, y]) => project(x, y, 0)), 'hero-floor', 0)
    : '';

  const solids = massing.segments.map((segment, index) => {
    const top = polygon(
      segment.corners.map(([x, y]) => project(x, y, segment.height)),
      segment.kind === 'sill' ? 'hero-face-sill' : 'hero-face-top',
      index,
    );
    return `<g class="hero-solid" style="--face:${index}">${visibleSides(segment, index)}${top}</g>`;
  }).join('');

  const entrance = massing.entrance
    ? (() => {
      const [x, y] = project(massing.entrance[0], massing.entrance[1], 0);
      return `<circle class="hero-entrance" cx="${round(x)}" cy="${round(y)}" r="${round(unit * 0.018)}" />`;
    })()
    : '';

  const title = options.title ?? 'Approximate 3D layout built from the floor plan';
  return `<svg class="hero-massing" viewBox="${round(vx)} ${round(vy)} ${round(vw)} ${round(vh)}" `
    + `xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)}" `
    + `style="--faces:${massing.segments.length}">`
    + floor
    + solids
    + entrance
    + `</svg>`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

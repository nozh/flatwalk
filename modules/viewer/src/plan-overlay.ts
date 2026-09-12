import type { FlatModel } from '@flatwalk/contract';

/**
 * Two-dimensional top view built straight from the wall graph.
 * This is an interface highlight layer (select a room, see where a photo looks), not Builder's renderOverlay
 * and not Geometry Core: no faces, no areas, no collisions are computed here.
 */

export type OverlayWall = { id: string; x1: number; y1: number; x2: number; y2: number; width: number; exterior: boolean };
export type OverlayOpening = {
  id: string; kind: 'door' | 'window'; x1: number; y1: number; x2: number; y2: number; width: number;
  entrance: boolean; passable: boolean;
};
export type OverlayRoom = { id: string; label: string; x: number; y: number };

export type Overlay = {
  /** plan: picture + model marks; plan-only: picture without scale; scheme: marks without picture; empty: nothing to draw. */
  mode: 'plan' | 'plan-only' | 'scheme' | 'empty';
  viewBox: [number, number, number, number];
  image: { url: string; width: number; height: number } | null;
  walls: OverlayWall[];
  openings: OverlayOpening[];
  rooms: OverlayRoom[];
};

export type PlanInfo = { url: string | null; width?: number; height?: number; pxPerMeter?: number };

const SCHEME_SCALE = 100;
const SCHEME_MARGIN = 1.2;

function marks(model: FlatModel, scale: number): Pick<Overlay, 'walls' | 'openings' | 'rooms'> {
  const walls: OverlayWall[] = [];
  const openings: OverlayOpening[] = [];
  const vertex = (id: string) => model.vertices[id];

  for (const [id, wall] of Object.entries(model.walls)) {
    const a = vertex(wall.a);
    const b = vertex(wall.b);
    if (!a || !b) continue;
    walls.push({ id, x1: a[0] * scale, y1: a[1] * scale, x2: b[0] * scale, y2: b[1] * scale, width: wall.thickness * scale, exterior: wall.exterior });
  }

  for (const [id, opening] of Object.entries(model.openings)) {
    const wall = model.walls[opening.wall];
    const a = wall ? vertex(wall.a) : undefined;
    const b = wall ? vertex(wall.b) : undefined;
    if (!wall || !a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    const start = opening.at;
    const end = opening.at + opening.width;
    openings.push({
      id,
      kind: opening.kind,
      x1: (a[0] + ux * start) * scale,
      y1: (a[1] + uy * start) * scale,
      x2: (a[0] + ux * end) * scale,
      y2: (a[1] + uy * end) * scale,
      width: wall.thickness * scale,
      entrance: opening.kind === 'door' && opening.entrance === true,
      passable: opening.kind === 'door' ? opening.passable !== false : false,
    });
  }

  const rooms: OverlayRoom[] = Object.entries(model.rooms).map(([id, room]) => ({
    id, label: room.label, x: room.anchor[0] * scale, y: room.anchor[1] * scale,
  }));

  return { walls, openings, rooms };
}

export function buildOverlay(model: FlatModel, plan: PlanInfo, planAvailable: boolean): Overlay {
  const hasPicture = planAvailable && plan.url !== null && plan.width !== undefined && plan.height !== undefined;
  const hasWalls = Object.keys(model.walls).length > 0;

  if (hasPicture) {
    const image = { url: plan.url as string, width: plan.width as number, height: plan.height as number };
    if (plan.pxPerMeter === undefined) {
      return { mode: 'plan-only', viewBox: [0, 0, image.width, image.height], image, walls: [], openings: [], rooms: [] };
    }
    return { mode: 'plan', viewBox: [0, 0, image.width, image.height], image, ...marks(model, plan.pxPerMeter) };
  }

  if (!hasWalls) return { mode: 'empty', viewBox: [0, 0, 1, 1], image: null, walls: [], openings: [], rooms: [] };

  const points = Object.values(model.vertices);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  for (const room of Object.values(model.rooms)) { xs.push(room.anchor[0]); ys.push(room.anchor[1]); }
  const minX = Math.min(...xs) - SCHEME_MARGIN;
  const minY = Math.min(...ys) - SCHEME_MARGIN;
  const maxX = Math.max(...xs) + SCHEME_MARGIN;
  const maxY = Math.max(...ys) + SCHEME_MARGIN;
  return {
    mode: 'scheme',
    viewBox: [minX * SCHEME_SCALE, minY * SCHEME_SCALE, (maxX - minX) * SCHEME_SCALE, (maxY - minY) * SCHEME_SCALE],
    image: null,
    ...marks(model, SCHEME_SCALE),
  };
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

const round = (value: number) => Math.round(value * 10) / 10;

export type OverlayOptions = { selectedRoom?: string | null; facedWalls?: string[] };

export function renderOverlaySvg(overlay: Overlay, options: OverlayOptions = {}): string {
  const [vx, vy, vw, vh] = overlay.viewBox;
  const faced = new Set(options.facedWalls ?? []);
  // Sizes follow the drawing, not the pixel count, so an 80 px demo plan and a 940 px scan read the same.
  const unit = Math.max(vw, vh) / 14;
  const labelSize = round(unit * 0.23);
  const pin = round(unit * 0.1);
  const halo = round(labelSize * 0.28);
  const ring = round(pin * 0.38);

  const image = overlay.image
    ? `<image href="${escapeXml(overlay.image.url)}" x="0" y="0" width="${overlay.image.width}" height="${overlay.image.height}" preserveAspectRatio="none" />`
    : '';

  const walls = overlay.walls.map((wall) => {
    const classes = ['overlay-wall', wall.exterior ? 'is-exterior' : 'is-interior', faced.has(wall.id) ? 'is-faced' : ''].filter(Boolean).join(' ');
    return `<line class="${classes}" data-wall="${escapeXml(wall.id)}" x1="${round(wall.x1)}" y1="${round(wall.y1)}" x2="${round(wall.x2)}" y2="${round(wall.y2)}" stroke-width="${round(Math.max(wall.width, 2))}" />`;
  }).join('');

  const openings = overlay.openings.map((opening) => {
    const classes = ['overlay-opening', opening.kind === 'door' ? 'is-door' : 'is-window', opening.passable ? '' : 'is-glazed'].filter(Boolean).join(' ');
    return `<line class="${classes}" x1="${round(opening.x1)}" y1="${round(opening.y1)}" x2="${round(opening.x2)}" y2="${round(opening.y2)}" stroke-width="${round(Math.max(opening.width, 2))}" />`;
  }).join('');

  const entrance = overlay.openings.find((opening) => opening.entrance);
  const entranceMark = entrance
    ? (() => {
      const mx = (entrance.x1 + entrance.x2) / 2;
      const my = (entrance.y1 + entrance.y2) / 2;
      return `<g class="overlay-entrance" transform="translate(${round(mx)} ${round(my)})"><circle r="${round(pin * 0.9)}" stroke-width="${ring}" /><text y="${round(pin * 2.4)}" font-size="${round(labelSize * 0.85)}" stroke-width="${halo}" text-anchor="middle">entrance</text></g>`;
    })()
    : '';

  const rooms = overlay.rooms.map((room) => {
    const selected = options.selectedRoom === room.id;
    return `<g class="overlay-room${selected ? ' is-selected' : ''}" data-room="${escapeXml(room.id)}" role="button" tabindex="0" aria-label="${escapeXml(room.label)}" aria-pressed="${selected}" transform="translate(${round(room.x)} ${round(room.y)})">`
      + `<circle class="overlay-room-halo" r="${round(pin * 3.2)}" />`
      + `<circle class="overlay-room-pin" r="${round(pin)}" />`
      + `<text class="overlay-room-label" y="${round(pin * 2.6)}" font-size="${labelSize}" text-anchor="middle">${escapeXml(room.label)}</text>`
      + `</g>`;
  }).join('');

  return `<svg class="plan-overlay is-${overlay.mode}" viewBox="${vx} ${vy} ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Apartment floor plan with model overlay">`
    + image
    + `<g class="overlay-marks">${walls}${openings}${entranceMark}${rooms}</g>`
    + `</svg>`;
}

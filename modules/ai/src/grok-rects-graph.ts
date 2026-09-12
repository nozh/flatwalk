import type { Meta, Opening, Room, Wall } from "@flatwalk/contract";
import {
  DEFAULT_DOOR_WIDTH,
  DEFAULT_WALL_THICKNESS,
  GRID_METERS,
  GROK_RECTS_CONFIDENCE,
  GROK_RECTS_MODULE,
  MIN_SHARED_EDGE_M,
  SNAP_METERS,
  type GrokRectsResult,
  type GrokRectsRoomType,
} from "./grok-rects-schema.js";

const EPS = 0.01;

export type Point = [number, number];

export type GraphRoom = {
  id: string;
  type: GrokRectsRoomType;
  anchor: Point;
  label: string;
  question?: string;
};

export type DroppedDoor = {
  between: [string, string];
  reason: string;
};

export type RectGraph = {
  vertices: Record<string, Point>;
  walls: Record<string, Wall>;
  rooms: Record<string, GraphRoom>;
  openings: Record<string, Opening>;
  droppedDoors: DroppedDoor[];
};

export type RectGraphResult =
  | { ok: true; graph: RectGraph }
  | { ok: false; reason: string; intersectingRooms: [string, string][] };

type RectM = {
  id: string;
  type: GrokRectsRoomType;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function snapCoord(value: number): number {
  return Math.round(value / SNAP_METERS) * SNAP_METERS;
}

function keyOf(x: number, y: number): string {
  return `${x.toFixed(4)},${y.toFixed(4)}`;
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

function between(value: number, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return value >= lo - EPS && value <= hi + EPS;
}

function interiorOverlap(a: RectM, b: RectM): boolean {
  return (
    a.left < b.right - EPS &&
    b.left < a.right - EPS &&
    a.top < b.bottom - EPS &&
    b.top < a.bottom - EPS
  );
}

function onRectEdge(px: number, py: number, rect: RectM): boolean {
  const onVertical =
    (almostEqual(px, rect.left) || almostEqual(px, rect.right)) && between(py, rect.top, rect.bottom);
  const onHorizontal =
    (almostEqual(py, rect.top) || almostEqual(py, rect.bottom)) && between(px, rect.left, rect.right);
  return onVertical || onHorizontal;
}

function meta(question?: string): Meta {
  return {
    provenance: GROK_RECTS_MODULE,
    basis: "assumed",
    confidence: GROK_RECTS_CONFIDENCE,
    ...(question ? { question } : {}),
  };
}

function lengthOf(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Minimal snap for axis-aligned rectangles only.
 * OpenCV contour snap lives in Python and is not reused here: this path never
 * sees polylines, collinear degree-2 merges of arbitrary contours, or colour masks.
 * Shared edges become one wall; T-vertices split the longer edge.
 */
export function rectsToGraph(result: GrokRectsResult, doorWidth = DEFAULT_DOOR_WIDTH): RectGraphResult {
  const rects: RectM[] = result.rooms.map((room) => {
    const left = snapCoord(room.rect[0] * GRID_METERS);
    const top = snapCoord(room.rect[1] * GRID_METERS);
    const right = snapCoord((room.rect[0] + room.rect[2]) * GRID_METERS);
    const bottom = snapCoord((room.rect[1] + room.rect[3]) * GRID_METERS);
    return { id: room.id, type: room.type, left, top, right, bottom };
  });

  const intersectingRooms: [string, string][] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (interiorOverlap(rects[i]!, rects[j]!)) {
        intersectingRooms.push([rects[i]!.id, rects[j]!.id]);
      }
    }
  }
  if (intersectingRooms.length) {
    return {
      ok: false,
      reason: "intersecting-rectangles",
      intersectingRooms,
    };
  }

  const rawPoints = new Map<string, Point>();
  const addPoint = (x: number, y: number) => {
    const sx = snapCoord(x);
    const sy = snapCoord(y);
    rawPoints.set(keyOf(sx, sy), [sx, sy]);
  };
  for (const rect of rects) {
    addPoint(rect.left, rect.top);
    addPoint(rect.right, rect.top);
    addPoint(rect.right, rect.bottom);
    addPoint(rect.left, rect.bottom);
  }
  for (const point of [...rawPoints.values()]) {
    for (const rect of rects) {
      if (onRectEdge(point[0], point[1], rect)) addPoint(point[0], point[1]);
    }
  }
  // Corners of one room that lie on another room's edge (T-junctions).
  for (const rect of rects) {
    for (const point of [...rawPoints.values()]) {
      if (onRectEdge(point[0], point[1], rect)) addPoint(point[0], point[1]);
    }
  }

  const sortedPoints = [...rawPoints.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const vertices: Record<string, Point> = {};
  const idByKey = new Map<string, string>();
  sortedPoints.forEach((point, index) => {
    const id = `v${index + 1}`;
    vertices[id] = point;
    idByKey.set(keyOf(point[0], point[1]), id);
  });

  type WallAcc = { a: string; b: string; rooms: Set<string> };
  const wallAcc = new Map<string, WallAcc>();

  const pointOnSide = (point: Point, a: Point, b: Point) => {
    if (almostEqual(a[1], b[1])) {
      return almostEqual(point[1], a[1]) && between(point[0], a[0], b[0]);
    }
    if (almostEqual(a[0], b[0])) {
      return almostEqual(point[0], a[0]) && between(point[1], a[1], b[1]);
    }
    return false;
  };

  const addRoomSides = (rect: RectM) => {
    const corners: Point[] = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.right, rect.bottom],
      [rect.left, rect.bottom],
    ];
    const sides: [Point, Point][] = [
      [corners[0]!, corners[1]!],
      [corners[1]!, corners[2]!],
      [corners[2]!, corners[3]!],
      [corners[3]!, corners[0]!],
    ];
    for (const [start, end] of sides) {
      const along = sortedPoints.filter((point) => pointOnSide(point, start, end));
      along.sort((p, q) =>
        almostEqual(start[1], end[1]) ? p[0] - q[0] : p[1] - q[1],
      );
      for (let i = 0; i < along.length - 1; i += 1) {
        const pa = along[i]!;
        const pb = along[i + 1]!;
        if (lengthOf(pa, pb) < EPS) continue;
        const ia = idByKey.get(keyOf(pa[0], pa[1]));
        const ib = idByKey.get(keyOf(pb[0], pb[1]));
        if (!ia || !ib) continue;
        const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
        const wallKey = `${lo}|${hi}`;
        const existing = wallAcc.get(wallKey);
        if (existing) existing.rooms.add(rect.id);
        else wallAcc.set(wallKey, { a: lo, b: hi, rooms: new Set([rect.id]) });
      }
    }
  };
  for (const rect of rects) addRoomSides(rect);

  const wallEntries = [...wallAcc.entries()].sort(([a], [b]) => a.localeCompare(b));
  const walls: Record<string, Wall> = {};
  const wallIdByKey = new Map<string, string>();
  wallEntries.forEach(([, acc], index) => {
    const id = `w${index + 1}`;
    wallIdByKey.set(`${acc.a}|${acc.b}`, id);
    walls[id] = {
      a: acc.a,
      b: acc.b,
      thickness: DEFAULT_WALL_THICKNESS,
      exterior: acc.rooms.size === 1,
      meta: meta(),
    };
  });

  const rooms: Record<string, GraphRoom> = {};
  for (const rect of rects) {
    rooms[rect.id] = {
      id: rect.id,
      type: rect.type,
      label: rect.id,
      anchor: [snapCoord((rect.left + rect.right) / 2), snapCoord((rect.top + rect.bottom) / 2)],
    };
  }

  const wallsBetween = (left: string, right: string) =>
    wallEntries
      .filter(([, acc]) => acc.rooms.has(left) && acc.rooms.has(right))
      .map(([key, acc]) => {
        const wallId = wallIdByKey.get(key)!;
        const a = vertices[acc.a]!;
        const b = vertices[acc.b]!;
        return { wallId, length: lengthOf(a, b), a: acc.a, b: acc.b };
      })
      .sort((x, y) => y.length - x.length);

  const droppedDoors: DroppedDoor[] = [];
  const openings: Record<string, Opening> = {};
  let openingIndex = 1;

  const placeDoor = (wallId: string, extra: Partial<Opening> = {}) => {
    const wall = walls[wallId]!;
    const len = lengthOf(vertices[wall.a]!, vertices[wall.b]!);
    const width = Math.min(doorWidth, Math.max(MIN_SHARED_EDGE_M, len - 0.1));
    if (len < MIN_SHARED_EDGE_M || width + 0.02 > len) return null;
    const id = `o${openingIndex}`;
    openingIndex += 1;
    const opening: Opening = {
      wall: wallId,
      kind: "door",
      at: (len - width) / 2,
      width,
      meta: meta(),
      ...extra,
    };
    openings[id] = opening;
    return id;
  };

  for (const door of result.doors) {
    const [left, right] = door.between;
    const shared = wallsBetween(left, right);
    const usable = shared.find((item) => item.length + EPS >= MIN_SHARED_EDGE_M);
    if (!usable) {
      const reason =
        shared.length === 0
          ? "no shared wall long enough for a door (rooms are not adjacent)"
          : `shared edge ${shared[0]!.length.toFixed(2)} m is shorter than ${MIN_SHARED_EDGE_M} m`;
      droppedDoors.push({ between: [left, right], reason });
      const question = `Door ${left}–${right} dropped: rooms have no shared wall ≥ ${MIN_SHARED_EDGE_M} m; no fictitious passage was created.`;
      rooms[left]!.question = rooms[left]!.question ? `${rooms[left]!.question} ${question}` : question;
      rooms[right]!.question = rooms[right]!.question ? `${rooms[right]!.question} ${question}` : question;
      continue;
    }
    placeDoor(usable.wallId);
  }

  const entranceWalls = wallEntries
    .filter(([, acc]) => acc.rooms.size === 1 && acc.rooms.has(result.entrance))
    .map(([key, acc]) => {
      const wallId = wallIdByKey.get(key)!;
      const len = lengthOf(vertices[acc.a]!, vertices[acc.b]!);
      return { wallId, length: len };
    })
    .sort((a, b) => b.length - a.length);
  const entranceWall = entranceWalls[0];
  if (entranceWall) {
    placeDoor(entranceWall.wallId, { entrance: true });
  } else {
    const question = "Entrance room has no exterior wall; entrance opening was not created.";
    rooms[result.entrance]!.question = rooms[result.entrance]!.question
      ? `${rooms[result.entrance]!.question} ${question}`
      : question;
  }

  return {
    ok: true,
    graph: { vertices, walls, rooms, openings, droppedDoors },
  };
}

export function graphRoomToContract(room: GraphRoom): Room {
  return {
    anchor: room.anchor,
    type: room.type,
    label: room.label,
    meta: meta(room.question),
  };
}

export function assumedPlanMeta(): Meta {
  return meta();
}

export function snapBoundaryNote(): string {
  return [
    "Owner: modules/ai grok-rects (TypeScript).",
    "Applies only to axis-aligned rectangles on the 0.5 m grid, then 5 cm quantization.",
    "Shared rectangle edges become one wall; vertices on a neighbour edge split that edge (T-junctions).",
    "Does not implement OpenCV polyline simplification, collinear degree-2 merges of arbitrary contours, or thick-mask openings.",
    "Python plan_parser snap must not be rewritten to match this helper; a shared snap owner is still an open decision.",
  ].join(" ");
}

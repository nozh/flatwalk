import type { FlatModel, Opening } from '@flatwalk/contract';
import { GeometryError } from './errors.js';
import {
  TOL,
  type Point,
  area,
  contains,
  distance,
  lerp,
  normalize,
  onBoundary,
  projectOnSegment,
  segmentsCross,
  signedArea,
  sub,
  wallPoint,
} from './primitives.js';

export type Face = {
  vertices: string[];
  walls: string[];
  polygon: Point[];
};

export type CollisionSegment = {
  a: Point;
  b: Point;
  wall: string;
  thickness: number;
};

type SplitEdge = {
  id: string;
  wallId: string;
  a: string;
  b: string;
  aAt: number;
  bAt: number;
};

export type GraphDerived = {
  faces: Face[];
  collisions: CollisionSegment[];
  edges: SplitEdge[];
};

function vertex(model: FlatModel, id: string): Point {
  const p = model.vertices[id];
  if (!p) throw new GeometryError('nonplanar', `Missing vertex ${id}`, [`vertices.${id}`]);
  return p;
}

function buildSplitEdges(model: FlatModel): SplitEdge[] {
  const ids = Object.keys(model.vertices);
  const edges: SplitEdge[] = [];
  for (const [wallId, wall] of Object.entries(model.walls)) {
    const a = vertex(model, wall.a);
    const b = vertex(model, wall.b);
    const length = distance(a, b);
    if (length < TOL) {
      throw new GeometryError('nonplanar', `Wall ${wallId} is shorter than 1 cm`, [`walls.${wallId}`]);
    }
    const cuts: { id: string; at: number }[] = [
      { id: wall.a, at: 0 },
      { id: wall.b, at: length },
    ];
    for (const vid of ids) {
      if (vid === wall.a || vid === wall.b) continue;
      const p = vertex(model, vid);
      const proj = projectOnSegment(p, a, b);
      if (proj.dist >= TOL) continue;
      const at = proj.t * length;
      if (at <= TOL || at >= length - TOL) continue;
      cuts.push({ id: vid, at });
    }
    cuts.sort((x, y) => x.at - y.at);
    const seen = new Map<string, number>();
    const unique: { id: string; at: number }[] = [];
    for (const cut of cuts) {
      const prev = seen.get(cut.id);
      if (prev !== undefined && Math.abs(prev - cut.at) <= TOL) continue;
      seen.set(cut.id, cut.at);
      unique.push(cut);
    }
    for (let i = 0; i < unique.length - 1; i++) {
      const from = unique[i], to = unique[i + 1];
      if (to.at - from.at < TOL) continue;
      edges.push({
        id: `${wallId}:${from.id}:${to.id}`,
        wallId,
        a: from.id,
        b: to.id,
        aAt: from.at,
        bAt: to.at,
      });
    }
  }

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i], f = edges[j];
      if (e.wallId === f.wallId) continue;
      const a = vertex(model, e.a), b = vertex(model, e.b);
      const c = vertex(model, f.a), d = vertex(model, f.b);
      if (segmentsCross(a, b, c, d)) {
        throw new GeometryError(
          'nonplanar',
          `Walls ${e.wallId} and ${f.wallId} cross away from a vertex`,
          [`walls.${e.wallId}`, `walls.${f.wallId}`],
        );
      }
    }
  }
  return edges;
}

type Adj = { to: string; edge: SplitEdge; angle: number };

function adjacency(model: FlatModel, edges: SplitEdge[]) {
  const adj = new Map<string, Adj[]>();
  const add = (from: string, to: string, edge: SplitEdge) => {
    const a = vertex(model, from);
    const b = vertex(model, to);
    const list = adj.get(from) ?? [];
    list.push({ to, edge, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    adj.set(from, list);
  };
  for (const edge of edges) {
    add(edge.a, edge.b, edge);
    add(edge.b, edge.a, edge);
  }
  for (const list of adj.values()) list.sort((x, y) => x.angle - y.angle);
  return adj;
}

function directedKey(from: string, to: string, edgeId: string) {
  return `${from}>${to}@${edgeId}`;
}

function walkFaces(model: FlatModel, edges: SplitEdge[]): Face[] {
  const adj = adjacency(model, edges);
  const used = new Set<string>();
  const faces: Face[] = [];

  const nextOutgoing = (from: string, to: string): Adj => {
    const list = adj.get(to);
    if (!list?.length) throw new GeometryError('nonplanar', `Dangling vertex ${to}`, [`vertices.${to}`]);
    const reverse = list.findIndex(item => item.to === from);
    if (reverse < 0) throw new GeometryError('nonplanar', `Graph is not bidirectional at ${to}`, [`vertices.${to}`]);
    return list[(reverse - 1 + list.length) % list.length];
  };

  for (const [from, list] of adj) {
    for (const start of list) {
      const startKey = directedKey(from, start.to, start.edge.id);
      if (used.has(startKey)) continue;
      const verts: string[] = [from];
      const walls: string[] = [];
      let curFrom = from;
      let cur = start;
      for (let guard = 0; guard < edges.length * 4; guard++) {
        const key = directedKey(curFrom, cur.to, cur.edge.id);
        if (used.has(key)) {
          throw new GeometryError('nonplanar', 'Half-edge reused by two walks', [`walls.${cur.edge.wallId}`]);
        }
        used.add(key);
        walls.push(cur.edge.wallId);
        verts.push(cur.to);
        const nxt = nextOutgoing(curFrom, cur.to);
        const nextKey = directedKey(cur.to, nxt.to, nxt.edge.id);
        curFrom = cur.to;
        cur = nxt;
        if (nextKey === startKey) break;
      }
      if (verts.at(-1) === verts[0]) verts.pop();
      if (verts.length < 3) {
        throw new GeometryError('nonplanar', 'Face has fewer than 3 vertices', walls.slice(0, 3).map(id => `walls.${id}`));
      }
      faces.push({ vertices: verts, walls, polygon: verts.map(id => vertex(model, id)) });
    }
  }

  if (used.size !== edges.length * 2) {
    throw new GeometryError('nonplanar', 'Not every wall side belongs to a face');
  }
  return faces;
}

function unboundedIndex(faces: Face[]) {
  const signed = faces.map(face => signedArea(face.polygon));
  let best = 0;
  for (let i = 1; i < signed.length; i++) {
    if (Math.abs(signed[i]) > Math.abs(signed[best])) best = i;
  }
  const pos = signed.filter(v => v > 0).length;
  const neg = signed.filter(v => v < 0).length;
  if (pos && neg) {
    const minority = pos < neg ? 1 : -1;
    const candidates = signed
      .map((v, i) => ({ v, i }))
      .filter(x => Math.sign(x.v) === minority || (minority === 1 ? x.v > 0 : x.v < 0));
    if (candidates.length === 1) return candidates[0].i;
  }
  return best;
}

export function deriveGraph(model: FlatModel): GraphDerived {
  const edges = buildSplitEdges(model);
  if (!edges.length) return { faces: [], collisions: [], edges };
  const allFaces = walkFaces(model, edges);
  const outer = unboundedIndex(allFaces);
  const faces = allFaces.filter((_, i) => i !== outer);
  const collisions = collisionSegments(model, edges, faces);
  return { faces, collisions, edges };
}

export function isInteriorPassableDoor(opening: Opening) {
  if (opening.kind !== 'door') return false;
  if (opening.entrance) return false;
  if (opening.passable === false) return false;
  return true;
}

function collisionSegments(model: FlatModel, edges: SplitEdge[], faces: Face[]): CollisionSegment[] {
  const result: CollisionSegment[] = [];
  for (const [wallId, wall] of Object.entries(model.walls)) {
    const a = vertex(model, wall.a);
    const b = vertex(model, wall.b);
    const length = distance(a, b);
    const gaps = Object.values(model.openings)
      .filter(opening => opening.wall === wallId && isInteriorPassableDoor(opening))
      .map(opening => ({ start: opening.at, end: opening.at + opening.width }))
      .sort((x, y) => x.start - y.start);

    const pieces: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const gap of gaps) {
      const start = Math.max(0, Math.min(length, gap.start));
      const end = Math.max(0, Math.min(length, gap.end));
      if (start > cursor + 0.001) pieces.push({ start: cursor, end: start });
      cursor = Math.max(cursor, end);
    }
    if (length > cursor + 0.001) pieces.push({ start: cursor, end: length });

    const dir = normalize(sub(b, a));
    const normals: Point[] = [
      [-dir[1], dir[0]],
      [dir[1], -dir[0]],
    ];
    const mid = wallPoint(a, b, length / 2);
    const inward = normals.filter(normal => {
      const sample: Point = [mid[0] + normal[0] * 0.02, mid[1] + normal[1] * 0.02];
      return faces.some(face => contains(sample, face.polygon, false));
    });
    const offsets = inward.length ? inward : [normals[0]];
    const half = wall.thickness / 2;

    for (const piece of pieces) {
      const pa = wallPoint(a, b, piece.start);
      const pb = wallPoint(a, b, piece.end);
      const extendStart = piece.start <= 0.001 ? half : 0;
      const extendEnd = piece.end >= length - 0.001 ? half : 0;
      for (const normal of offsets) {
        const oa: Point = [
          pa[0] + normal[0] * half - dir[0] * extendStart,
          pa[1] + normal[1] * half - dir[1] * extendStart,
        ];
        const ob: Point = [
          pb[0] + normal[0] * half + dir[0] * extendEnd,
          pb[1] + normal[1] * half + dir[1] * extendEnd,
        ];
        result.push({ a: oa, b: ob, wall: wallId, thickness: wall.thickness });
      }
    }
  }
  return result;
}

export function faceContaining(faces: Face[], point: Point): Face | null {
  const hits = faces.filter(face => contains(point, face.polygon, true) && !onBoundary(point, face.polygon, TOL));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new GeometryError('ambiguous-mapping', 'Point lies in more than one bounded face');
  }
  return null;
}

export function polygonForAnchor(faces: Face[], anchor: Point): Point[] | null {
  if (faces.some(face => onBoundary(anchor, face.polygon, TOL))) return null;
  const face = faces.find(item => contains(anchor, item.polygon, false));
  return face ? face.polygon.map(p => [p[0], p[1]] as Point) : null;
}

export function mapRooms(model: FlatModel, faces: Face[]) {
  const polygons: Record<string, Point[] | null> = {};
  const faceRooms = new Map<Face, string[]>();
  for (const [id, room] of Object.entries(model.rooms)) {
    const onWall = faces.some(face => onBoundary(room.anchor, face.polygon, TOL));
    if (onWall) {
      polygons[id] = null;
      continue;
    }
    const hits = faces.filter(face => contains(room.anchor, face.polygon, false));
    if (hits.length > 1) {
      throw new GeometryError('ambiguous-mapping', `Anchor of ${id} lies in more than one face`, [`rooms.${id}`]);
    }
    if (hits.length === 1) {
      polygons[id] = hits[0].polygon.map(p => [p[0], p[1]] as Point);
      const list = faceRooms.get(hits[0]) ?? [];
      list.push(id);
      faceRooms.set(hits[0], list);
    } else {
      polygons[id] = null;
    }
  }
  for (const [face, rooms] of faceRooms) {
    if (rooms.length > 1) {
      throw new GeometryError(
        'ambiguous-mapping',
        `Rooms ${rooms.join(', ')} share one face`,
        rooms.map(id => `rooms.${id}`),
      );
    }
    void face;
  }
  return { polygons, faceRooms };
}

export function areasFromPolygons(polygons: Record<string, Point[] | null>) {
  const rooms: Record<string, number> = {};
  let areaComputed = 0;
  for (const [id, polygon] of Object.entries(polygons)) {
    if (!polygon) continue;
    const value = area(polygon);
    rooms[id] = value;
    areaComputed += value;
  }
  return { rooms, areaComputed };
}

export function roomsBesideWall(model: FlatModel, polygons: Record<string, Point[] | null>, wallId: string, at: number) {
  const wall = model.walls[wallId];
  const a = vertex(model, wall.a);
  const b = vertex(model, wall.b);
  const length = distance(a, b);
  const p = wallPoint(a, b, Math.max(0, Math.min(length, at)));
  const dir = normalize(sub(b, a));
  const samples: Point[] = [
    [p[0] - dir[1] * 0.05, p[1] + dir[0] * 0.05],
    [p[0] + dir[1] * 0.05, p[1] - dir[0] * 0.05],
  ];
  const roomIds: string[] = [];
  for (const sample of samples) {
    for (const [id, polygon] of Object.entries(polygons)) {
      if (polygon && contains(sample, polygon, false)) roomIds.push(id);
    }
  }
  return [...new Set(roomIds)];
}

export function inwardNormal(model: FlatModel, wallId: string, toward: Point): Point | null {
  const wall = model.walls[wallId];
  if (!wall) return null;
  const a = vertex(model, wall.a);
  const b = vertex(model, wall.b);
  const dir = normalize(sub(b, a));
  const mid = lerp(a, b, 0.5);
  const candidates: Point[] = [
    [-dir[1], dir[0]],
    [dir[1], -dir[0]],
  ];
  let best: Point | null = null;
  let bestDot = -Infinity;
  for (const normal of candidates) {
    const sample: Point = [mid[0] + normal[0], mid[1] + normal[1]];
    const score = (toward[0] - mid[0]) * normal[0] + (toward[1] - mid[1]) * normal[1];
    if (score > bestDot) {
      bestDot = score;
      best = normal;
    }
    void sample;
  }
  return best;
}

export { wallPoint };

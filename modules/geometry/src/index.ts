import type { FlatModel } from '@flatwalk/contract';
import { GeometryError } from './errors.js';
import {
  areasFromPolygons,
  deriveGraph,
  inwardNormal,
  isInteriorPassableDoor,
  mapRooms,
  polygonForAnchor,
  roomsBesideWall,
  type CollisionSegment,
  type Face,
  type GraphDerived,
} from './graph.js';
import { distance, normalize, type Point, wallPoint } from './primitives.js';

export { GeometryError, type GeometryErrorCode } from './errors.js';
export type { CollisionSegment, Face } from './graph.js';
export type { Point } from './primitives.js';

export type Areas = {
  rooms: Record<string, number>;
  areaComputed: number;
};

export type AdjacencyEdge = {
  opening: string;
  rooms: [string, string];
};

export type StartPoint = {
  point: Point;
  facing: Point;
};

export type RoomPath = {
  rooms: string[];
  openings: string[];
};

export type WallSide = {
  normal: Point;
};

type RoomDerived = {
  polygons: Record<string, Point[] | null>;
  areas: Areas;
  adjacency: AdjacencyEdge[];
};

let graphKey = '';
let graphValue: GraphDerived | null = null;
let roomKey = '';
let roomValue: RoomDerived | null = null;

function fingerprint(value: unknown) {
  return JSON.stringify(value);
}

function graphFingerprint(model: FlatModel) {
  return fingerprint({ vertices: model.vertices, walls: model.walls, openings: model.openings });
}

function roomFingerprint(model: FlatModel) {
  const anchors = Object.fromEntries(Object.entries(model.rooms).map(([id, room]) => [id, room.anchor]));
  const entrance = Object.fromEntries(
    Object.entries(model.openings).map(([id, opening]) => [id, opening.kind === 'door' ? { entrance: opening.entrance, passable: opening.passable, wall: opening.wall, at: opening.at, width: opening.width } : { wall: opening.wall }]),
  );
  return fingerprint({ graph: graphFingerprint(model), anchors, entrance });
}

function graphOf(model: FlatModel) {
  const key = graphFingerprint(model);
  if (graphValue && graphKey === key) return graphValue;
  graphValue = deriveGraph(model);
  graphKey = key;
  return graphValue;
}

function roomsOf(model: FlatModel) {
  const key = roomFingerprint(model);
  if (roomValue && roomKey === key) return roomValue;
  const graph = graphOf(model);
  const mapped = mapRooms(model, graph.faces);
  roomValue = {
    polygons: mapped.polygons,
    areas: areasFromPolygons(mapped.polygons),
    adjacency: adjacencyOf(model, mapped.polygons),
  };
  roomKey = key;
  return roomValue;
}

function adjacencyOf(model: FlatModel, polygons: Record<string, Point[] | null>): AdjacencyEdge[] {
  const edges: AdjacencyEdge[] = [];
  for (const [id, opening] of Object.entries(model.openings)) {
    if (!isInteriorPassableDoor(opening)) continue;
    const rooms = roomsBesideWall(model, polygons, opening.wall, opening.at + opening.width / 2);
    if (rooms.length !== 2) continue;
    const pair = rooms[0] < rooms[1] ? [rooms[0], rooms[1]] as [string, string] : [rooms[1], rooms[0]] as [string, string];
    edges.push({ opening: id, rooms: pair });
  }
  edges.sort((a, b) => a.opening.localeCompare(b.opening));
  return edges;
}

export function faces(model: FlatModel): Face[] {
  return graphOf(model).faces;
}

export function roomPolygon(model: FlatModel, roomId: string): Point[] | null {
  if (!model.rooms[roomId]) throw new GeometryError('missing-room', `Unknown room ${roomId}`, [`rooms.${roomId}`]);
  return roomsOf(model).polygons[roomId] ?? null;
}

export function areas(model: FlatModel): Areas {
  return roomsOf(model).areas;
}

export function adjacency(model: FlatModel): AdjacencyEdge[] {
  return roomsOf(model).adjacency;
}

export function collisions(model: FlatModel): CollisionSegment[] {
  return graphOf(model).collisions;
}

export function wallSide(model: FlatModel, wallId: string, roomId: string): WallSide {
  if (!model.walls[wallId]) throw new GeometryError('wall-not-on-room', `Unknown wall ${wallId}`, [`walls.${wallId}`]);
  const polygon = roomPolygon(model, roomId);
  if (!polygon) throw new GeometryError('wall-not-on-room', `Room ${roomId} has no polygon`, [`rooms.${roomId}`]);
  const roomFace = faces(model).find(face => face.walls.includes(wallId) && polygonContainsSame(face.polygon, polygon));
  if (!roomFace) {
    throw new GeometryError('wall-not-on-room', `Wall ${wallId} is not on the contour of ${roomId}`, [`walls.${wallId}`, `rooms.${roomId}`]);
  }
  const centroid: Point = [
    polygon.reduce((s, p) => s + p[0], 0) / polygon.length,
    polygon.reduce((s, p) => s + p[1], 0) / polygon.length,
  ];
  const normal = inwardNormal(model, wallId, centroid);
  if (!normal) throw new GeometryError('wall-not-on-room', `Cannot orient wall ${wallId}`, [`walls.${wallId}`]);
  return { normal };
}

function polygonContainsSame(a: Point[], b: Point[]) {
  if (a.length !== b.length) return false;
  const key = (pts: Point[]) => pts.map(p => `${p[0]},${p[1]}`).sort().join('|');
  return key(a) === key(b);
}

export function startPoint(model: FlatModel): StartPoint {
  const entrances = Object.entries(model.openings).filter(([, opening]) => opening.kind === 'door' && opening.entrance);
  if (entrances.length !== 1) {
    throw new GeometryError('invalid-start', `Expected one entrance, found ${entrances.length}`);
  }
  const [id, opening] = entrances[0];
  const wall = model.walls[opening.wall];
  const a = model.vertices[wall.a];
  const b = model.vertices[wall.b];
  const center = wallPoint(a, b, opening.at + opening.width / 2);
  const mapped = roomsOf(model);
  const beside = roomsBesideWall(model, mapped.polygons, opening.wall, opening.at + opening.width / 2);
  if (beside.length !== 1) {
    throw new GeometryError('invalid-start', 'Entrance must bound exactly one room', [`openings.${id}`]);
  }
  const polygon = mapped.polygons[beside[0]];
  if (!polygon) throw new GeometryError('invalid-start', 'Entrance room has no polygon', [`rooms.${beside[0]}`]);
  const centroid: Point = [
    polygon.reduce((s, p) => s + p[0], 0) / polygon.length,
    polygon.reduce((s, p) => s + p[1], 0) / polygon.length,
  ];
  const facing = inwardNormal(model, opening.wall, centroid);
  if (!facing) throw new GeometryError('invalid-start', 'Cannot face inward from entrance', [`openings.${id}`]);
  const point: Point = [center[0] + facing[0], center[1] + facing[1]];
  const host = Object.entries(mapped.polygons).find(([, poly]) => poly && polygonContainsPoint(point, poly));
  if (!host) {
    throw new GeometryError('invalid-start', 'Start 1 m inward is not inside a room', [`openings.${id}`]);
  }
  for (const segment of collisions(model)) {
    if (distanceToSegment(point, segment.a, segment.b) < 1e-3) {
      throw new GeometryError('invalid-start', 'Start 1 m inward intersects a wall', [`openings.${id}`]);
    }
  }
  return { point, facing: normalize(facing) };
}

function polygonContainsPoint(p: Point, polygon: Point[]) {
  return polygonForAnchor([{ vertices: [], walls: [], polygon }], p) !== null;
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-18) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

export function path(model: FlatModel, fromRoom: string, toRoom: string): RoomPath | null {
  if (!model.rooms[fromRoom] || !model.rooms[toRoom]) {
    throw new GeometryError('missing-room', 'Unknown room in path', [fromRoom, toRoom].filter(id => !model.rooms[id]).map(id => `rooms.${id}`));
  }
  if (fromRoom === toRoom) return { rooms: [fromRoom], openings: [] };
  const edges = adjacency(model);
  const graph = new Map<string, { to: string; opening: string }[]>();
  for (const edge of edges) {
    const a = graph.get(edge.rooms[0]) ?? [];
    const b = graph.get(edge.rooms[1]) ?? [];
    a.push({ to: edge.rooms[1], opening: edge.opening });
    b.push({ to: edge.rooms[0], opening: edge.opening });
    graph.set(edge.rooms[0], a);
    graph.set(edge.rooms[1], b);
  }
  const queue = [fromRoom];
  const prev = new Map<string, { from: string; opening: string }>();
  const seen = new Set([fromRoom]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const step of graph.get(cur) ?? []) {
      if (seen.has(step.to)) continue;
      seen.add(step.to);
      prev.set(step.to, { from: cur, opening: step.opening });
      if (step.to === toRoom) {
        const rooms = [toRoom];
        const openings: string[] = [];
        let node = toRoom;
        while (node !== fromRoom) {
          const link = prev.get(node)!;
          openings.unshift(link.opening);
          rooms.unshift(link.from);
          node = link.from;
        }
        return { rooms, openings };
      }
      queue.push(step.to);
    }
  }
  return null;
}

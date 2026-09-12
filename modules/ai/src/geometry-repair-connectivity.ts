import type { FlatModel, ValidationReport } from "@flatwalk/contract";
import { faces, roomPolygon } from "@flatwalk/geometry";

export const MIN_INTERIOR_DOOR_WALL_M = 0.8;

function polygonKey(points: number[][]): string {
  return points.map((point) => `${point[0]},${point[1]}`).sort().join("|");
}

export function wallLength(model: FlatModel, wallId: string): number {
  const wall = model.walls[wallId];
  if (!wall) return 0;
  const a = model.vertices[wall.a];
  const b = model.vertices[wall.b];
  if (!a || !b) return 0;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function roomsOnWall(model: FlatModel, wallId: string): string[] {
  const ids: string[] = [];
  const allFaces = faces(model);
  for (const id of Object.keys(model.rooms).sort()) {
    const polygon = roomPolygon(model, id);
    if (!polygon) continue;
    if (allFaces.some((face) => face.walls.includes(wallId) && polygonKey(face.polygon) === polygonKey(polygon))) {
      ids.push(id);
    }
  }
  return ids;
}

export function sharedInteriorWalls(model: FlatModel) {
  const rows: Array<{ rooms: [string, string]; wall: string; length: number }> = [];
  for (const wallId of Object.keys(model.walls).sort()) {
    const rooms = roomsOnWall(model, wallId);
    if (rooms.length === 2) {
      rows.push({
        rooms: [rooms[0]!, rooms[1]!].sort() as [string, string],
        wall: wallId,
        length: Math.round(wallLength(model, wallId) * 1000) / 1000,
      });
    }
  }
  return rows;
}

export function connectivityForRepair(model: FlatModel, report: ValidationReport) {
  const shared = sharedInteriorWalls(model);
  const unreachable = report.checks
    .filter((check) => check.status === "fail" && check.checkId.startsWith("navigation.reachable."))
    .map((check) => check.checkId.slice("navigation.reachable.".length));
  return {
    sharedWalls: shared,
    unreachable: unreachable.map((roomId) => ({
      roomId,
      sharedWalls: shared.filter((row) => row.rooms.includes(roomId)),
      question: model.rooms[roomId]?.meta.question,
    })),
  };
}

export function fictitiousInteriorDoor(before: FlatModel, after: FlatModel): string | undefined {
  for (const id of Object.keys(after.openings).sort()) {
    const opening = after.openings[id]!;
    const previous = before.openings[id];
    if (
      previous &&
      previous.kind === opening.kind &&
      previous.wall === opening.wall &&
      previous.width === opening.width &&
      (previous.kind !== "door" ||
        (opening.kind === "door" &&
          previous.passable === opening.passable &&
          previous.entrance === opening.entrance))
    ) {
      continue;
    }
    if (opening.kind !== "door" || opening.passable === false) continue;
    if (opening.entrance) continue;
    const rooms = roomsOnWall(after, opening.wall);
    const length = wallLength(after, opening.wall);
    if (rooms.length === 2 && length + 1e-9 >= MIN_INTERIOR_DOOR_WALL_M) {
      continue;
    }
    return `openings.${id}`;
  }
  return undefined;
}

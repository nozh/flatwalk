/**
 * Replay saved grok-rects live patch for 54541. Does not call x.ai.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PatchSchema, validateFlatModel, type FlatModel, type Patch } from "@flatwalk/contract";
import { adjacency, faces, roomPolygon } from "@flatwalk/geometry";
import { apply } from "@flatwalk/resolver";
import { validate } from "@flatwalk/validator";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const docsDir = path.join(repoRoot, "../../docs/modules/plan-parser-54541");

async function sha256(file: string): Promise<string> {
  const buf = await readFile(file);
  return createHash("sha256").update(buf).digest("hex");
}

function emptyRev0(id: string): FlatModel {
  const meta = { provenance: "importer@0.1", basis: "assumed" as const };
  return {
    schemaVersion: "0.1",
    id,
    revision: 0,
    source: { site: "cityexpert", listingId: "54541", fetchedAt: "2026-09-12T10:00:00Z" },
    flat: {
      areaDeclared: 105,
      roomsDeclared: 3.5,
      meta: { provenance: "importer@0.1", basis: "declared" },
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: {
          wallHeight: { ...meta },
          doorHeight: { ...meta },
          windowSill: { ...meta },
          windowHeight: { ...meta },
        },
      },
    },
    plan: { asset: null, meta: { ...meta } },
    vertices: {},
    walls: {},
    openings: {},
    rooms: {},
    assets: {},
  };
}

function bindPatchToModel(patch: Patch, model: FlatModel): Patch {
  return { ...patch, modelId: model.id, baseRevision: model.revision };
}

function almostEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

function wallLength(model: FlatModel, wallId: string): number {
  const wall = model.walls[wallId]!;
  const a = model.vertices[wall.a]!;
  const b = model.vertices[wall.b]!;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function roomsOnWall(model: FlatModel, wallId: string): string[] {
  const ids: string[] = [];
  const allFaces = faces(model);
  for (const id of Object.keys(model.rooms).sort()) {
    const polygon = roomPolygon(model, id);
    if (!polygon) continue;
    const key = (pts: number[][]) => pts.map((p) => `${p[0]},${p[1]}`).sort().join("|");
    const hit = allFaces.some(
      (face) => face.walls.includes(wallId) && key(face.polygon) === key(polygon),
    );
    if (hit) ids.push(id);
  }
  return ids;
}

function sharedWalls(model: FlatModel) {
  const pairs: Array<{ rooms: [string, string]; wall: string; length: number }> = [];
  for (const wallId of Object.keys(model.walls).sort()) {
    const rooms = roomsOnWall(model, wallId);
    if (rooms.length === 2) {
      pairs.push({
        rooms: [rooms[0]!, rooms[1]!].sort() as [string, string],
        wall: wallId,
        length: Math.round(wallLength(model, wallId) * 1000) / 1000,
      });
    }
  }
  return pairs;
}

function bbox(model: FlatModel, roomId: string) {
  const polygon = roomPolygon(model, roomId);
  if (!polygon) return null;
  const xs = polygon.map((p) => p[0]);
  const ys = polygon.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function cornerOnly(a: NonNullable<ReturnType<typeof bbox>>, b: NonNullable<ReturnType<typeof bbox>>): boolean {
  const xTouch = almostEqual(a.maxX, b.minX) || almostEqual(b.maxX, a.minX);
  const yTouch = almostEqual(a.maxY, b.minY) || almostEqual(b.maxY, a.minY);
  const xOverlap = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const yOverlap = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return (xTouch && yTouch && xOverlap < 0.05 && yOverlap < 0.05) || (xTouch && yOverlap < 0.05) || (yTouch && xOverlap < 0.05);
}

const files = {
  patch: path.join(docsDir, "grok-rects-54541.live.patch.json"),
  response: path.join(docsDir, "grok-rects-54541.live.response.json"),
  probe: path.join(docsDir, "grok-rects-54541.probe-live.json"),
  plan: path.join(repoRoot, "fixtures/54541/plan.png"),
};

const hashes = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await sha256(file)])),
);

const rawPatch = PatchSchema.parse(JSON.parse(await readFile(files.patch, "utf8")));
const probe = JSON.parse(await readFile(files.probe, "utf8")) as {
  droppedDoors: { between: [string, string]; reason: string }[];
  pipeline: { validatorFailed: string[] };
};

const imported = emptyRev0("cityexpert-54541");
const probeModel = emptyRev0("cityexpert-54541-empty");

const mismatch = apply(imported, rawPatch, {
  schemaVersion: "0.1",
  modelId: imported.id,
  baseRevision: 0,
  currentRevision: 0,
  changes: [],
});

const bound = bindPatchToModel(rawPatch, imported);
const applied = apply(imported, bound, {
  schemaVersion: "0.1",
  modelId: imported.id,
  baseRevision: 0,
  currentRevision: 0,
  changes: [],
});

const probeApplied = apply(probeModel, rawPatch, {
  schemaVersion: "0.1",
  modelId: probeModel.id,
  baseRevision: 0,
  currentRevision: 0,
  changes: [],
});

const model = applied.model;
const report = validate(model);
const contract = validateFlatModel(model);
const faceList = faces(model);
const adj = adjacency(model);
const shared = sharedWalls(model);
const boxes = Object.fromEntries(
  Object.keys(model.rooms)
    .sort()
    .map((id) => [id, bbox(model, id)]),
);

const unreachable = report.checks
  .filter((check) => check.status === "fail" && check.checkId.startsWith("navigation.reachable."))
  .map((check) => check.checkId.replace("navigation.reachable.", ""));

const diagnosis = unreachable.map((roomId) => {
  const box = boxes[roomId];
  const neighbors = shared.filter((row) => row.rooms.includes(roomId));
  const dropped = probe.droppedDoors.filter((row) => row.between.includes(roomId));
  const hallBox = boxes.hall;
  return {
    roomId,
    bbox: box,
    sharedWalls: neighbors,
    droppedDoors: dropped,
    vsHall: box && hallBox ? { cornerOnly: cornerOnly(box, hallBox), hall: hallBox } : null,
  };
});

const out = {
  hashes,
  livePatchEnvelope: { modelId: rawPatch.modelId, baseRevision: rawPatch.baseRevision, opCount: rawPatch.ops.length },
  applyWithoutRemap: {
    rejected: mismatch.rejected,
    revision: mismatch.model.revision,
    id: mismatch.model.id,
  },
  applyRemappedToImported: {
    id: model.id,
    revision: model.revision,
    rejected: applied.rejected,
    contractSuccess: contract.success,
    walkReady: report.walkReady,
    failed: report.checks.filter((c) => c.status === "fail").map((c) => ({ id: c.checkId, status: c.status, message: c.message })),
    skipped: report.checks.filter((c) => c.status === "skipped").map((c) => c.checkId),
    faces: faceList.length,
    adjacency: adj.map((edge) => `${edge.rooms[0]}-${edge.rooms[1]}:${edge.opening}`),
    openings: Object.entries(model.openings).map(([id, o]) => ({
      id,
      wall: o.wall,
      kind: o.kind,
      width: o.width,
      entrance: o.kind === "door" ? o.entrance : undefined,
      rooms: roomsOnWall(model, o.wall),
    })),
    sharedWalls: shared,
    boxes,
    diagnosis,
    probeApplyId: probeApplied.model.id,
    probeApplyRevision: probeApplied.model.revision,
  },
};

console.log(JSON.stringify(out, null, 2));

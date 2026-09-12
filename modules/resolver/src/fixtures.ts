import { FlatModelSchema, type FlatModel, type Patch, type RevisionContext } from "@flatwalk/contract";

const assumed = { provenance: "importer@0.1", basis: "assumed" as const };
const declared = { provenance: "importer@0.1", basis: "declared" as const };

export const emptyModel: FlatModel = FlatModelSchema.parse({
  schemaVersion: "0.1",
  id: "synthetic",
  revision: 0,
  source: { site: "manual", fetchedAt: "2026-09-12T10:00:00Z" },
  flat: {
    meta: declared,
    defaults: {
      wallHeight: 2.8,
      doorHeight: 2.1,
      windowSill: 0.9,
      windowHeight: 1.5,
      meta: {
        wallHeight: { ...assumed },
        doorHeight: { ...assumed },
        windowSill: { ...assumed },
        windowHeight: { ...assumed },
      },
    },
  },
  plan: { asset: null, meta: assumed },
  vertices: {},
  walls: {},
  openings: {},
  rooms: {},
  assets: {},
});

export const smallModel: FlatModel = FlatModelSchema.parse({
  ...emptyModel,
  revision: 1,
  vertices: { v1: [0, 0], v2: [4, 0], v3: [4, 3], v4: [0, 3] },
  walls: {
    w1: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { ...assumed } },
    w2: { a: "v3", b: "v4", thickness: 0.2, exterior: true, meta: { ...assumed } },
  },
  openings: { o1: { wall: "w1", kind: "door", at: 0.2, width: 0.9, entrance: true, meta: { ...assumed } } },
  rooms: {
    r1: {
      anchor: [1, 1],
      type: "living",
      label: "Synthetic room",
      meta: { ...assumed, question: "type?", alternatives: [{
        module: "plan-parser@0.1",
        baseRevision: 0,
        atRevision: 1,
        reason: "conflict",
        op: { op: "set", path: "rooms.r1.type", value: "bedroom" },
      }] },
      dressing: {
        level: 2,
        floor: "parquet",
        panorama: "pano1",
        yaw: 90,
        yawFor: "pano1",
        meta: {
          level: { ...assumed },
          floor: { ...assumed },
          panorama: { ...assumed },
          yaw: { ...assumed },
        },
      },
    },
  },
  assets: {
    "plan-01": { kind: "plan", url: "materials/plan.png", width: 100, height: 100, meta: { ...assumed } },
    p1: {
      kind: "photo",
      url: "materials/photo.jpg",
      width: 300,
      height: 200,
      room: "r1",
      faces: "w1",
      meta: { ...assumed },
      look: { floor: "unknown", wallTone: "light" },
    },
    pano1: {
      kind: "panorama",
      url: "materials/pano.jpg",
      width: 200,
      height: 100,
      projection: "equirectangular",
      generatedBy: "synthetic-test",
      fromPhoto: "p1",
      meta: { ...assumed },
    },
  },
  plan: { asset: "plan-01", meta: assumed },
});

export function patch(model: FlatModel, module: string, ops: Patch["ops"], baseRevision = model.revision): Patch {
  return { schemaVersion: "0.1", modelId: model.id, baseRevision, module, ops };
}

export function currentSince(model: FlatModel): RevisionContext {
  return {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: model.revision,
    currentRevision: model.revision,
    changes: [],
  };
}

export function since(model: FlatModel, baseRevision: number, changes: RevisionContext["changes"]): RevisionContext {
  return {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision,
    currentRevision: model.revision,
    changes,
  };
}

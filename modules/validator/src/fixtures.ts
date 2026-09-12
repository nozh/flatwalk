import { SCHEMA_VERSION, validateFlatModel, type FlatModel, type Meta } from "@flatwalk/contract";

export const META: Meta = { provenance: "validator-test@0.1", basis: "inferred" };

const defaultMeta = {
  wallHeight: META,
  doorHeight: META,
  windowSill: META,
  windowHeight: META,
};

export function parseModel(value: unknown): FlatModel {
  const parsed = validateFlatModel(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  }
  return parsed.data;
}

export function wall(a: string, b: string, thickness = 0.2, exterior = false) {
  return { a, b, thickness, exterior, meta: META };
}

export function room(anchor: [number, number], type: FlatModel["rooms"][string]["type"] = "unknown", label = "Room") {
  return { anchor, type, label, meta: META };
}

export function door(wallId: string, at: number, width: number, extra: Record<string, unknown> = {}) {
  return { wall: wallId, kind: "door" as const, at, width, meta: META, ...extra };
}

export function photo(id: string, extra: Record<string, unknown> = {}) {
  return {
    kind: "photo" as const,
    url: `photos/${id}.jpg`,
    width: 1920,
    height: 1080,
    room: "left" as string | null,
    faces: null as string | null,
    meta: { ...META },
    ...extra,
  };
}

/** Two 4×3 m rooms; left entrance on w61, interior door on w25. */
export function walkableTwoRooms(over: Record<string, unknown> = {}): FlatModel {
  return parseModel({
    schemaVersion: SCHEMA_VERSION,
    id: "val-synth",
    revision: 1,
    source: { site: "manual", fetchedAt: "2026-09-12T10:00:00Z" },
    flat: {
      meta: META,
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: defaultMeta,
      },
    },
    plan: { asset: null, meta: { ...META, basis: "assumed" } },
    vertices: {
      v1: [0, 0], v2: [4, 0], v3: [8, 0], v4: [8, 3], v5: [4, 3], v6: [0, 3],
    },
    walls: {
      w12: wall("v1", "v2", 0.2, true),
      w23: wall("v2", "v3", 0.2, true),
      w34: wall("v3", "v4", 0.2, true),
      w45: wall("v4", "v5", 0.2, true),
      w56: wall("v5", "v6", 0.2, true),
      w61: wall("v6", "v1", 0.2, true),
      w25: wall("v2", "v5", 0.2, false),
    },
    openings: {
      d1: door("w25", 1, 1),
      enter: door("w61", 1, 1, { entrance: true }),
    },
    rooms: {
      left: room([2, 1.5], "living", "Left"),
      right: room([6, 1.5], "bedroom", "Right"),
    },
    assets: {},
    ...over,
  });
}

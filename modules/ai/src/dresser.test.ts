import { describe, expect, it } from "vitest";
import { PatchSchema, validateFlatModel, type FlatModel, type Op } from "@flatwalk/contract";
import { apply } from "@flatwalk/resolver";
import { DRESSER_MODULE, runDresserL1 } from "./dresser.js";

const META = { provenance: "importer@0.1", basis: "assumed" as const };

function baseModel(over: Partial<FlatModel> = {}): FlatModel {
  return {
    schemaVersion: "0.1",
    id: "cityexpert-dresser",
    revision: 2,
    source: { site: "manual", fetchedAt: "2026-09-12T10:00:00Z" },
    flat: {
      meta: { provenance: "importer@0.1", basis: "declared" },
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: {
          wallHeight: { ...META },
          doorHeight: { ...META },
          windowSill: { ...META },
          windowHeight: { ...META },
        },
      },
    },
    plan: { asset: "plan", pxPerMeter: 20, meta: { ...META, basis: "declared-area" } },
    vertices: {
      v1: [0, 0],
      v2: [4, 0],
      v3: [8, 0],
      v4: [8, 3],
      v5: [4, 3],
      v6: [0, 3],
    },
    walls: {
      w1: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { ...META } },
      w2: { a: "v2", b: "v3", thickness: 0.2, exterior: true, meta: { ...META } },
      w3: { a: "v3", b: "v4", thickness: 0.2, exterior: true, meta: { ...META } },
      w4: { a: "v4", b: "v5", thickness: 0.2, exterior: true, meta: { ...META } },
      w5: { a: "v5", b: "v6", thickness: 0.2, exterior: true, meta: { ...META } },
      w6: { a: "v6", b: "v1", thickness: 0.2, exterior: true, meta: { ...META } },
      w7: { a: "v2", b: "v5", thickness: 0.2, exterior: false, meta: { ...META } },
    },
    openings: {
      o1: { kind: "door", wall: "w6", at: 1, width: 0.9, entrance: true, meta: { ...META } },
      o2: { kind: "door", wall: "w7", at: 1, width: 0.9, meta: { ...META } },
    },
    rooms: {
      r1: { anchor: [2, 1.5], type: "bedroom", label: "Bedroom", meta: { ...META } },
      r2: { anchor: [6, 1.5], type: "kitchen", label: "Kitchen", meta: { ...META } },
    },
    assets: {
      plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
    },
    ...over,
  };
}

function photo(
  id: string,
  room: string | null,
  floor: "parquet" | "tile" | "laminate" | "unknown" | undefined,
): FlatModel["assets"][string] {
  return {
    kind: "photo",
    url: `materials/${id}.jpg`,
    width: 800,
    height: 600,
    room,
    faces: null,
    ...(floor
      ? { look: { floor, wallTone: "light" as const } }
      : {}),
    meta: { ...META },
  };
}

function currentSince(model: FlatModel) {
  return {
    schemaVersion: "0.1" as const,
    modelId: model.id,
    baseRevision: model.revision,
    currentRevision: model.revision,
    changes: [],
  };
}

function dressingOps(ops: Op[], roomId: string): Op[] {
  return ops.filter((op) => op.path.startsWith(`rooms.${roomId}.dressing`));
}

describe("runDresserL1", () => {
  it("uses the unique look.floor mode and type fallbacks without calling a network", () => {
    const model = baseModel({
      rooms: {
        r1: { anchor: [2, 1.5], type: "bedroom", label: "Bedroom", meta: { ...META } },
        r2: { anchor: [6, 1.5], type: "kitchen", label: "Kitchen", meta: { ...META } },
        r3: { anchor: [2, 4], type: "bathroom", label: "Bath", meta: { ...META } },
        r4: { anchor: [6, 4], type: "wc", label: "WC", meta: { ...META } },
        r5: { anchor: [10, 1.5], type: "hall", label: "Hall", meta: { ...META } },
      },
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        p1: photo("p1", "r1", "parquet"),
        p2: photo("p2", "r1", "parquet"),
        p3: photo("p3", "r1", "tile"),
      },
    });

    const result = runDresserL1({ model });
    expect(result.diagnostics.liveApiCalled).toBe(false);
    expect(result.patch.module).toBe(DRESSER_MODULE);
    expect(result.patch.modelId).toBe(model.id);
    expect(result.patch.baseRevision).toBe(model.revision);
    expect(PatchSchema.safeParse(result.patch).success).toBe(true);

    const applied = apply(model, result.patch, currentSince(model));
    expect(applied.rejected).toEqual([]);
    expect(applied.model.rooms.r1?.dressing).toMatchObject({
      level: 1,
      floor: "parquet",
    });
    expect(applied.model.rooms.r1?.dressing?.meta.floor).toMatchObject({
      provenance: DRESSER_MODULE,
      basis: "inferred",
    });
    expect(applied.model.rooms.r2?.dressing).toMatchObject({ level: 1, floor: "tile" });
    expect(applied.model.rooms.r2?.dressing?.meta.floor?.basis).toBe("assumed");
    expect(applied.model.rooms.r3?.dressing?.floor).toBe("tile");
    expect(applied.model.rooms.r4?.dressing?.floor).toBe("tile");
    expect(applied.model.rooms.r5?.dressing?.floor).toBe("parquet");
    expect(applied.model.vertices).toEqual(model.vertices);
    expect(applied.model.assets).toEqual(model.assets);
    expect(validateFlatModel(applied.model).success).toBe(true);
  });

  it("ignores unknown and missing look when voting and falls back when no material votes remain", () => {
    const model = baseModel({
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        p1: photo("p1", "r1", "unknown"),
        p2: photo("p2", "r1", undefined),
        p3: photo("p3", null, "tile"),
        p4: photo("p4", "r2", "unknown"),
      },
    });

    const applied = apply(model, runDresserL1({ model }).patch, currentSince(model));
    expect(applied.model.rooms.r1?.dressing?.floor).toBe("parquet");
    expect(applied.model.rooms.r1?.dressing?.meta.floor?.basis).toBe("assumed");
    expect(applied.model.rooms.r2?.dressing?.floor).toBe("tile");
    expect(applied.model.rooms.r2?.dressing?.meta.floor?.basis).toBe("assumed");
  });

  it("breaks a look.floor tie by preferring the room-type fallback when it is among winners", () => {
    const model = baseModel({
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        p1: photo("p1", "r2", "parquet"),
        p2: photo("p2", "r2", "tile"),
      },
    });

    const result = runDresserL1({ model });
    const applied = apply(model, result.patch, currentSince(model));
    expect(applied.model.rooms.r2?.dressing?.floor).toBe("tile");
    expect(result.diagnostics.rooms.find((row) => row.roomId === "r2")?.source).toBe("tie-break");
  });

  it("breaks a look.floor tie with the canonical parquet-tile-laminate order when the fallback is not tied", () => {
    const model = baseModel({
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        p1: photo("p1", "r1", "tile"),
        p2: photo("p2", "r1", "laminate"),
      },
    });

    const applied = apply(model, runDresserL1({ model }).patch, currentSince(model));
    expect(applied.model.rooms.r1?.dressing?.floor).toBe("tile");
  });

  it("does not emit ops for human dressing slots and leaves geometry and photo bindings untouched", () => {
    const model = baseModel({
      rooms: {
        r1: {
          anchor: [2, 1.5],
          type: "bedroom",
          label: "Bedroom",
          meta: { ...META },
          dressing: {
            level: 1,
            floor: "parquet",
            yaw: 40,
            yawFor: "pano-kept",
            meta: {
              level: { provenance: DRESSER_MODULE, basis: "inferred" },
              floor: { provenance: "human", basis: "declared", reviewed: true },
              yaw: { provenance: "human", basis: "declared", reviewed: true },
            },
          },
        },
        r2: { anchor: [6, 1.5], type: "kitchen", label: "Kitchen", meta: { ...META } },
      },
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        p1: photo("p1", "r1", "tile"),
        p2: photo("p2", "r1", "tile"),
      },
    });
    const snapshot = structuredClone(model);

    const result = runDresserL1({ model });
    expect(dressingOps(result.patch.ops, "r1").some((op) => op.path === "rooms.r1.dressing.floor")).toBe(false);
    expect(result.patch.ops.some((op) => op.path.startsWith("assets.") || op.path.startsWith("vertices."))).toBe(
      false,
    );

    const applied = apply(model, result.patch, currentSince(model));
    expect(applied.model.rooms.r1?.dressing?.floor).toBe("parquet");
    expect(applied.model.rooms.r1?.dressing?.meta.floor?.provenance).toBe("human");
    expect(applied.model.rooms.r1?.dressing?.yaw).toBe(40);
    expect(applied.model.assets).toEqual(snapshot.assets);
    expect(applied.model.vertices).toEqual(snapshot.vertices);
    expect(model).toEqual(snapshot);
  });

  it("updates L1 floor on an L2 room without lowering level or clearing panorama", () => {
    const model = baseModel({
      rooms: {
        r1: {
          anchor: [2, 1.5],
          type: "bedroom",
          label: "Bedroom",
          meta: { ...META },
          dressing: {
            level: 2,
            floor: "parquet",
            panorama: "pano1",
            yaw: 12,
            yawFor: "pano1",
            meta: {
              level: { provenance: DRESSER_MODULE, basis: "inferred" },
              floor: { provenance: DRESSER_MODULE, basis: "inferred" },
              panorama: { provenance: "dresser-l2@0.1", basis: "inferred" },
              yaw: { provenance: "dresser-l2@0.1", basis: "inferred" },
            },
          },
        },
        r2: { anchor: [6, 1.5], type: "kitchen", label: "Kitchen", meta: { ...META } },
      },
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        pano1: {
          kind: "panorama",
          url: "dressing/pano1.jpg",
          width: 2048,
          height: 1024,
          projection: "equirectangular",
          generatedBy: "fal-ai/hunyuan_world",
          fromPhoto: "p1",
          meta: { ...META },
        },
        p1: photo("p1", "r1", "tile"),
        p2: photo("p2", "r1", "tile"),
      },
    });

    const applied = apply(model, runDresserL1({ model }).patch, currentSince(model));
    expect(applied.rejected).toEqual([]);
    expect(applied.model.rooms.r1?.dressing?.level).toBe(2);
    expect(applied.model.rooms.r1?.dressing?.panorama).toBe("pano1");
    expect(applied.model.rooms.r1?.dressing?.floor).toBe("tile");
  });

  it("returns an empty patch after Resolver apply, then recalculates when look votes change", () => {
    const model = baseModel({
      assets: {
        plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
        p1: photo("p1", "r1", "parquet"),
        p2: photo("p2", "r1", "parquet"),
      },
    });

    const first = apply(model, runDresserL1({ model }).patch, currentSince(model));
    expect(first.model.rooms.r1?.dressing?.floor).toBe("parquet");

    const repeat = runDresserL1({ model: first.model });
    expect(repeat.patch.ops).toEqual([]);
    const repeatApply = apply(first.model, repeat.patch, currentSince(first.model));
    expect(repeatApply.model.revision).toBe(first.model.revision);

    const retargeted = structuredClone(first.model);
    const p2 = retargeted.assets.p2;
    if (p2?.kind === "photo") p2.look = { floor: "tile", wallTone: "light" };
    retargeted.assets.p3 = photo("p3", "r1", "tile");
    const recalculated = apply(retargeted, runDresserL1({ model: retargeted }).patch, currentSince(retargeted));
    expect(recalculated.model.rooms.r1?.dressing?.floor).toBe("tile");
    expect(recalculated.model.rooms.r1?.dressing?.meta.floor?.basis).toBe("inferred");
  });
});

import { describe, expect, it } from "vitest";
import type { FlatModel, Patch } from "@flatwalk/contract";
import { bindPatchToModel } from "../src/saved-patch.ts";

const empty = {
  schemaVersion: "0.1",
  id: "cityexpert-54541",
  revision: 0,
  source: { site: "cityexpert", listingId: "54541", fetchedAt: "2026-09-12T10:00:00Z" },
  flat: {
    meta: { provenance: "importer@0.1", basis: "declared" },
    defaults: {
      wallHeight: 2.8,
      doorHeight: 2.1,
      windowSill: 0.9,
      windowHeight: 1.5,
      meta: {
        wallHeight: { provenance: "importer@0.1", basis: "assumed" },
        doorHeight: { provenance: "importer@0.1", basis: "assumed" },
        windowSill: { provenance: "importer@0.1", basis: "assumed" },
        windowHeight: { provenance: "importer@0.1", basis: "assumed" },
      },
    },
  },
  plan: { asset: null, meta: { provenance: "importer@0.1", basis: "assumed" } },
  vertices: {},
  walls: {},
  openings: {},
  rooms: {},
  assets: {},
} as FlatModel;

describe("bindPatchToModel", () => {
  it("rewrites the envelope to the imported model and keeps ops", () => {
    const patch: Patch = {
      schemaVersion: "0.1",
      modelId: "cityexpert-54541-empty",
      baseRevision: 0,
      module: "plan-parser/grok-rects@0.1",
      ops: [{ op: "set", path: "rooms.kit.label", value: "kit" }],
    };
    const bound = bindPatchToModel(patch, empty);
    expect(bound.patch.modelId).toBe("cityexpert-54541");
    expect(bound.patch.baseRevision).toBe(0);
    expect(bound.patch.ops).toEqual(patch.ops);
    expect(bound.remappedFrom).toBe("cityexpert-54541-empty");
  });

  it("refuses a saved patch whose baseRevision is not the current model", () => {
    const patch: Patch = {
      schemaVersion: "0.1",
      modelId: "cityexpert-54541-empty",
      baseRevision: 2,
      module: "plan-parser/grok-rects@0.1",
      ops: [{ op: "set", path: "rooms.kit.label", value: "kit" }],
    };
    expect(() => bindPatchToModel(patch, empty)).toThrow(/baseRevision/);
  });
});

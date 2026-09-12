import { describe, expect, it } from "vitest";
import { PatchSchema, type FlatModel } from "@flatwalk/contract";
import { validate } from "@flatwalk/validator";
import { createGrokClient } from "./grok.js";
import {
  GEOMETRY_REPAIR_FIXTURE_ID,
  GEOMETRY_REPAIR_MAX_ATTEMPTS,
  GEOMETRY_REPAIR_MODULE,
  parseGeometryRepairResult,
} from "./geometry-repair-schema.js";
import { runGeometryRepair, type GeometryRepairClient } from "./geometry-repair.js";

const META = { provenance: "importer@0.1", basis: "assumed" as const };

function twoRooms(over: Record<string, unknown> = {}): FlatModel {
  return {
    schemaVersion: "0.1",
    id: "val-synth",
    revision: 1,
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
    plan: { asset: null, meta: { ...META } },
    vertices: {
      v1: [0, 0],
      v2: [4, 0],
      v3: [8, 0],
      v4: [8, 3],
      v5: [4, 3],
      v6: [0, 3],
    },
    walls: {
      w12: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { ...META } },
      w23: { a: "v2", b: "v3", thickness: 0.2, exterior: true, meta: { ...META } },
      w34: { a: "v3", b: "v4", thickness: 0.2, exterior: true, meta: { ...META } },
      w45: { a: "v4", b: "v5", thickness: 0.2, exterior: true, meta: { ...META } },
      w56: { a: "v5", b: "v6", thickness: 0.2, exterior: true, meta: { ...META } },
      w61: { a: "v6", b: "v1", thickness: 0.2, exterior: true, meta: { ...META } },
      w25: { a: "v2", b: "v5", thickness: 0.2, exterior: false, meta: { ...META } },
    },
    openings: {
      d1: { wall: "w25", kind: "door", at: 1, width: 1, meta: { ...META } },
      enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
    },
    rooms: {
      left: { anchor: [2, 1.5], type: "living", label: "Left", meta: { ...META } },
      right: { anchor: [6, 1.5], type: "bedroom", label: "Right", meta: { ...META } },
    },
    assets: {},
    ...over,
  } as FlatModel;
}

function grokQueue(contents: string[]): GeometryRepairClient {
  let i = 0;
  return {
    mode: "fixture",
    chatCompletions: async () => {
      const content = contents[i++];
      if (content === undefined) {
        throw new Error(`unexpected Grok call; already used ${contents.length}`);
      }
      return {
        synthetic: true,
        note: "Synthetic geometry-repair completion. Not a live API result.",
        body: {
          choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
        },
      };
    },
  };
}

function failIds(model: FlatModel): string[] {
  return validate(model)
    .checks.filter(
      (check) =>
        check.status === "fail" &&
        (check.layer === "geometry" || check.layer === "consistency" || check.layer === "navigation"),
    )
    .map((check) => check.checkId)
    .sort();
}

describe("parseGeometryRepairResult", () => {
  it("rejects a FlatModel-shaped payload", () => {
    const parsed = parseGeometryRepairResult({
      schemaVersion: "0.1",
      id: "x",
      revision: 0,
      vertices: {},
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(" ")).toMatch(/FlatModel/);
  });
});

describe("runGeometryRepair", () => {
  it("does not call Grok when the accepted model has no geometric fails", async () => {
    const model = twoRooms();
    const grok = grokQueue(["should-not-run"]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("no-geometry-errors");
    expect(result.patch).toBeNull();
    expect(result.model).toBe(model);
    expect(result.attempts).toHaveLength(0);
    expect(result.diagnostics.liveApiCalled).toBe(false);
  });

  it("applies a fixture patch for a too-narrow door through Resolver and re-validates", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const snapshot = structuredClone(model);
    expect(validate(model).walkReady).toBe(false);

    const grok = grokQueue([
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }] }),
    ]);
    const result = await runGeometryRepair({ model, grok });

    expect(result.stopped).toBe("repaired");
    expect(result.model.revision).toBe(model.revision + 1);
    expect(result.model.openings.d1?.width).toBe(0.9);
    expect(validate(result.model).walkReady).toBe(true);
    expect(PatchSchema.safeParse(result.patch).success).toBe(true);
    expect(result.patch?.module).toBe(GEOMETRY_REPAIR_MODULE);
    expect(result.patch?.baseRevision).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.baseRevision).toBe(1);
    expect(result.attempts[0]?.report.revision).toBe(1);
    expect(result.attempts[0]?.nextReport?.revision).toBe(2);
    expect(model).toEqual(snapshot);
    expect(result.diagnostics.liveApiCalled).toBe(false);
  });

  it("rejects an invalid candidate without writing a model", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({ schemaVersion: "0.1", vertices: {}, walls: {} }),
      JSON.stringify({ schemaVersion: "0.1", revision: 9 }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("invalid-patch");
    expect(result.model).toBe(model);
    expect(result.model.revision).toBe(1);
    expect(result.patch).toBeNull();
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((step) => step.patch === null)).toBe(true);
  });

  it("stops when an applied patch does not reduce geometric fails", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const before = failIds(model);
    const grok = grokQueue([
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "rooms.left.label", value: "Still broken" }] }),
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }] }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("no-progress");
    expect(result.attempts).toHaveLength(1);
    expect(failIds(result.model)).toEqual(before);
    expect(result.model.rooms.left?.label).toBe("Still broken");
  });

  it("stops when a later attempt restores the previous fail set", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }] }),
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.4 }] }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("same-result");
    expect(result.attempts).toHaveLength(2);
    expect(result.model.openings.d1?.width).toBe(0.4);
  });

  it("stops after two attempts that make progress but never become walkReady", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 0.8, width: 0.4, meta: { ...META } },
        d2: { wall: "w25", kind: "door", at: 1.4, width: 1, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, meta: { ...META } },
      },
    });
    expect(validate(model).walkReady).toBe(false);
    const grok = grokQueue([
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }] }),
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.enter.entrance", value: true }] }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("attempts-exhausted");
    expect(result.attempts).toHaveLength(GEOMETRY_REPAIR_MAX_ATTEMPTS);
    expect(result.model.openings.d1?.width).toBe(0.9);
    expect(result.model.openings.enter?.entrance).toBe(true);
    expect(validate(result.model).walkReady).toBe(false);
    expect(result.attempts[0]?.baseRevision).toBe(1);
    expect(result.attempts[1]?.baseRevision).toBe(2);
    expect(result.attempts[0]?.report.revision).toBe(1);
    expect(result.attempts[1]?.report.revision).toBe(2);
    expect(result.attempts[0]?.model?.revision).toBe(2);
    expect(result.attempts[1]?.model?.revision).toBe(3);
    expect(result.attempts[0]?.apply?.touchedPaths.length).toBeGreaterThan(0);
    expect(result.attempts[1]?.apply?.touchedPaths.length).toBeGreaterThan(0);
    expect(result.attempts[0]?.apply?.touchedOwners).toEqual(expect.arrayContaining(["openings.d1"]));
    expect(result.attempts[1]?.apply?.touchedOwners).toEqual(expect.arrayContaining(["openings.enter"]));
    expect(result.patch?.baseRevision).toBe(2);
    expect(result.patch?.ops).toEqual([{ op: "set", path: "openings.enter.entrance", value: true }]);
  });

  it("keeps a new revision when Resolver rejects only some ops (human)", async () => {
    const model = twoRooms({
      openings: {
        d1: {
          wall: "w25",
          kind: "door",
          at: 1,
          width: 0.4,
          meta: { provenance: "human", basis: "declared", confidence: 0.4, reviewed: true },
        },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({
        refuse: null,
        ops: [
          { op: "set", path: "openings.d1.width", value: 0.9 },
          { op: "set", path: "rooms.left.label", value: "Living" },
        ],
      }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.model.revision).toBe(model.revision + 1);
    expect(result.model.openings.d1?.width).toBe(0.4);
    expect(result.model.rooms.left?.label).toBe("Living");
    expect(result.attempts[0]?.apply?.rejected.some((item) => item.reason === "human")).toBe(true);
    expect(result.attempts[0]?.apply?.applied.length).toBeGreaterThan(0);
    expect(result.attempts[0]?.model?.revision).toBe(model.revision + 1);
    expect(result.attempts[0]?.apply?.touchedPaths.length).toBeGreaterThan(0);
    expect(result.patch?.baseRevision).toBe(model.revision);
  });

  it("stops on an explicit Grok refusal without applying ops", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({
        refuse: "opening-fix-unclear",
        ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }],
      }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("refused");
    expect(result.model).toBe(model);
    expect(result.patch).toBeNull();
    expect(result.attempts[0]?.reason).toMatch(/opening-fix-unclear/);
  });

  it("does not overwrite human openings and does not raise confidence", async () => {
    const model = twoRooms({
      openings: {
        d1: {
          wall: "w25",
          kind: "door",
          at: 1,
          width: 0.4,
          meta: { provenance: "human", basis: "declared", confidence: 0.4, reviewed: true },
        },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({
        refuse: null,
        ops: [
          { op: "set", path: "openings.d1.width", value: 0.9 },
          {
            op: "set",
            path: "openings.d1.meta",
            value: { provenance: "human", basis: "inferred", confidence: 0.99 },
          },
        ],
      }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.model.openings.d1?.width).toBe(0.4);
    expect(result.model.openings.d1?.meta.provenance).toBe("human");
    expect(result.model.openings.d1?.meta.confidence).toBe(0.4);
    expect(result.stopped).toMatch(/no-progress|resolver-rejected/);
  });

  it("reads attempt fixtures from disk without network", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = createGrokClient({ mode: "fixture" });
    const result = await runGeometryRepair({
      model,
      grok,
      fixtureId: `${GEOMETRY_REPAIR_FIXTURE_ID}.fixable`,
    });
    expect(result.stopped).toBe("repaired");
    expect(result.diagnostics.liveApiCalled).toBe(false);
    expect(result.diagnostics.synthetic).toBe(true);
  });

  it("returns missing-config instead of a fake live success when XAI_API_KEY is absent", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 1, width: 0.4, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = createGrokClient({
      mode: "live",
      env: {},
      transport: async () => {
        throw new Error("network must not run without a key");
      },
    });
    const result = await runGeometryRepair({ model, grok });
    expect(result.stopped).toBe("missing-config");
    expect(result.diagnostics.liveApiCalled).toBe(false);
    expect(result.diagnostics.note).toMatch(/XAI_API_KEY/);
    expect(result.model).toBe(model);
  });
});

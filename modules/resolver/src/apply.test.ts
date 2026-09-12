import { describe, expect, it } from "vitest";
import { FlatModelSchema } from "@flatwalk/contract";
import { apply } from "./apply.js";
import { currentSince, emptyModel, patch, since, smallModel } from "./fixtures.js";

function snapshot(model: unknown) {
  return JSON.stringify(model);
}

describe("apply", () => {
  it("applies set and unset without mutating the input and bumps revision", () => {
    const model = structuredClone(smallModel);
    const before = snapshot(model);
    const result = apply(
      model,
      patch(model, "plan-parser@0.1", [
        { op: "set", path: "rooms.r1.label", value: "Hall" },
        { op: "unset", path: "assets.p1.look" },
      ]),
      currentSince(model),
    );
    expect(snapshot(model)).toBe(before);
    expect(result.rejected).toEqual([]);
    expect(result.applied).toHaveLength(2);
    expect(result.model).not.toBe(model);
    expect(result.model.revision).toBe(2);
    expect(result.model.rooms.r1?.label).toBe("Hall");
    expect(result.model.assets.p1).not.toHaveProperty("look");
    expect(model.rooms.r1?.label).toBe("Synthetic room");
    expect(model.assets.p1).toHaveProperty("look");
    expect(result.touchedPaths).toEqual(expect.arrayContaining(["rooms.r1.label", "assets.p1.look"]));
    expect(result.touchedOwners).toEqual(expect.arrayContaining(["rooms.r1", "assets.p1"]));
    expect(FlatModelSchema.safeParse(result.model).success).toBe(true);
  });

  it("creates linked vertices, walls and openings in one patch", () => {
    const model = structuredClone(emptyModel);
    const result = apply(
      model,
      patch(model, "plan-parser@0.1", [
        { op: "set", path: "openings.o1", value: { wall: "w1", kind: "door", at: 0.2, width: 0.9, meta: { provenance: "plan-parser@0.1", basis: "inferred" } } },
        { op: "set", path: "walls.w1", value: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { provenance: "plan-parser@0.1", basis: "inferred" } } },
        { op: "set", path: "vertices.v1", value: [0, 0] },
        { op: "set", path: "vertices.v2", value: [4, 0] },
      ]),
      currentSince(model),
    );
    expect(result.rejected).toEqual([]);
    expect(result.model.revision).toBe(1);
    expect(result.model.walls.w1?.a).toBe("v1");
    expect(result.model.openings.o1?.wall).toBe("w1");
    expect(model.vertices).toEqual({});
  });

  it("rejects the whole patch when a final reference cannot be resolved", () => {
    const model = structuredClone(smallModel);
    const before = snapshot(model);
    const result = apply(
      model,
      patch(model, "plan-parser@0.1", [
        { op: "set", path: "rooms.r1.label", value: "Should not stick" },
        { op: "set", path: "openings.o1.wall", value: "missing" },
      ]),
      currentSince(model),
    );
    expect(snapshot(model)).toBe(before);
    expect(result.model).toEqual(model);
    expect(result.model.revision).toBe(1);
    expect(result.applied).toEqual([]);
    expect(result.rejected.every((item) => item.reason === "contract")).toBe(true);
    expect(result.rejected).toHaveLength(2);
    expect(result.touchedPaths).toEqual([]);
  });

  it("accepts two independent patches of the same base revision", () => {
    const model = structuredClone(smallModel);
    const first = apply(
      model,
      patch(model, "plan-parser@0.1", [{ op: "set", path: "rooms.r1.label", value: "One" }], 1),
      currentSince(model),
    );
    expect(first.model.revision).toBe(2);
    const second = apply(
      first.model,
      patch(first.model, "dresser@0.1", [{ op: "set", path: "flat.defaults.wallHeight", value: 3.1 }], 1),
      since(first.model, 1, [{
        revision: 2,
        touchedPaths: first.touchedPaths,
        touchedOwners: first.touchedOwners,
      }]),
    );
    expect(second.rejected).toEqual([]);
    expect(second.model.revision).toBe(3);
    expect(second.model.rooms.r1?.label).toBe("One");
    expect(second.model.flat.defaults.wallHeight).toBe(3.1);
  });

  it("conflicts when the same entity changed after the base revision", () => {
    const model = structuredClone(smallModel);
    const first = apply(
      model,
      patch(model, "plan-parser@0.1", [{ op: "set", path: "rooms.r1.label", value: "One" }], 1),
      currentSince(model),
    );
    const second = apply(
      first.model,
      patch(first.model, "plan-parser@0.1", [{ op: "set", path: "rooms.r1.type", value: "bedroom" }], 1),
      since(first.model, 1, [{
        revision: 2,
        touchedPaths: first.touchedPaths,
        touchedOwners: first.touchedOwners,
      }]),
    );
    expect(second.model.rooms.r1?.type).toBe("living");
    expect(second.applied).toEqual([]);
    expect(second.rejected).toEqual([
      expect.objectContaining({ path: "rooms.r1.type", value: "bedroom", reason: "conflict" }),
    ]);
    const alt = second.model.rooms.r1?.meta.alternatives?.at(-1);
    expect(alt).toMatchObject({ reason: "conflict", module: "plan-parser@0.1", baseRevision: 1, atRevision: 3 });
    expect(second.model.revision).toBe(3);
  });

  it("rejects automatic edits of human owners and stores alternatives", () => {
    const seeded = structuredClone(smallModel);
    seeded.walls.w1!.meta = { provenance: "human", basis: "declared", reviewed: true };
    const model = FlatModelSchema.parse(seeded);
    const result = apply(
      model,
      patch(model, "validator/repair@0.1", [{ op: "set", path: "walls.w1.thickness", value: 0.4 }]),
      currentSince(model),
    );
    expect(result.model.walls.w1?.thickness).toBe(0.2);
    expect(result.rejected).toEqual([
      expect.objectContaining({ path: "walls.w1.thickness", value: 0.4, reason: "human" }),
    ]);
    expect(result.model.walls.w1?.meta.provenance).toBe("human");
    expect(result.model.walls.w1?.meta.reviewed).toBe(false);
    expect(result.model.walls.w1?.meta.alternatives?.at(-1)).toMatchObject({
      reason: "human",
      op: { op: "set", path: "walls.w1.thickness", value: 0.4 },
    });
  });

  it("allows a later editor patch on a human owner when there is no revision conflict", () => {
    const seeded = structuredClone(smallModel);
    seeded.rooms.r1!.meta = { provenance: "human", basis: "declared", reviewed: true, repair: [] };
    const model = FlatModelSchema.parse(seeded);
    const result = apply(
      model,
      patch(model, "editor@0.1", [
        { op: "set", path: "rooms.r1.label", value: "Edited" },
        { op: "set", path: "rooms.r1.meta", value: { provenance: "human", basis: "declared", reviewed: true, repair: [] } },
      ]),
      currentSince(model),
    );
    expect(result.rejected).toEqual([]);
    expect(result.model.rooms.r1?.label).toBe("Edited");
    expect(result.model.rooms.r1?.meta.provenance).toBe("human");
  });

  it("still rejects an editor patch that conflicts with a newer revision of the same entity", () => {
    const model = structuredClone(smallModel);
    const first = apply(
      model,
      patch(model, "plan-parser@0.1", [{ op: "set", path: "rooms.r1.label", value: "Current" }], 1),
      currentSince(model),
    );
    const editor = apply(
      first.model,
      patch(first.model, "editor@0.1", [{ op: "set", path: "rooms.r1.label", value: "Stale" }], 1),
      since(first.model, 1, [{
        revision: 2,
        touchedPaths: first.touchedPaths,
        touchedOwners: first.touchedOwners,
      }]),
    );
    expect(editor.rejected).toEqual([
      expect.objectContaining({ path: "rooms.r1.label", value: "Stale", reason: "conflict" }),
    ]);
    expect(editor.model.rooms.r1?.label).toBe("Current");
  });

  it("keeps provenance, question and alternatives when editor only confirms reviewed", () => {
    const model = structuredClone(smallModel);
    const question = model.rooms.r1?.meta.question;
    const alternatives = model.rooms.r1?.meta.alternatives;
    const result = apply(
      model,
      patch(model, "editor@0.1", [{ op: "set", path: "rooms.r1.meta.reviewed", value: true }]),
      currentSince(model),
    );
    expect(result.rejected).toEqual([]);
    expect(result.model.rooms.r1?.meta.reviewed).toBe(true);
    expect(result.model.rooms.r1?.meta.provenance).toBe("importer@0.1");
    expect(result.model.rooms.r1?.meta.question).toBe(question);
    expect(result.model.rooms.r1?.meta.alternatives).toEqual(alternatives);
  });

  it("lets dressing and defaults change independently of sibling human fields", () => {
    const seeded = structuredClone(smallModel);
    seeded.flat.defaults.meta.wallHeight = { provenance: "human", basis: "declared", reviewed: true };
    seeded.rooms.r1!.dressing!.meta.yaw = { provenance: "human", basis: "declared", reviewed: true };
    const model = FlatModelSchema.parse(seeded);
    const result = apply(
      model,
      patch(model, "dresser@0.1", [
        { op: "set", path: "flat.defaults.doorHeight", value: 2.2 },
        { op: "set", path: "rooms.r1.dressing.floor", value: "tile" },
      ]),
      currentSince(model),
    );
    expect(result.rejected).toEqual([]);
    expect(result.model.flat.defaults.doorHeight).toBe(2.2);
    expect(result.model.flat.defaults.wallHeight).toBe(2.8);
    expect(result.model.rooms.r1?.dressing?.floor).toBe("tile");
    expect(result.model.rooms.r1?.dressing?.yaw).toBe(90);
    expect(result.model.flat.defaults.meta.wallHeight.provenance).toBe("human");
    expect(result.model.rooms.r1?.dressing?.meta.yaw?.provenance).toBe("human");
  });

  it("protects a human wall when an automatic patch moves a connected vertex", () => {
    const seeded = structuredClone(smallModel);
    seeded.walls.w1!.meta = { provenance: "human", basis: "declared", reviewed: true };
    const model = FlatModelSchema.parse(seeded);
    const result = apply(
      model,
      patch(model, "validator/repair@0.1", [{ op: "set", path: "vertices.v1", value: [0.2, 0] }]),
      currentSince(model),
    );
    expect(result.model.vertices.v1).toEqual([0, 0]);
    expect(result.rejected[0]).toMatchObject({ path: "vertices.v1", reason: "human" });
    expect(result.model.walls.w1?.meta.alternatives?.at(-1)?.op).toEqual({
      op: "set",
      path: "vertices.v1",
      value: [0.2, 0],
    });
  });

  it("does not bump revision for an empty patch", () => {
    const model = structuredClone(smallModel);
    const result = apply(model, patch(model, "plan-parser@0.1", []), currentSince(model));
    expect(result.model.revision).toBe(1);
    expect(result.applied).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.touchedPaths).toEqual([]);
    expect(result.model).toEqual(model);
  });

  it("does not bump revision when every op is rejected without a place to store alternatives", () => {
    const model = FlatModelSchema.parse({
      ...emptyModel,
      revision: 1,
      vertices: { v1: [0, 0] },
    });
    const result = apply(
      model,
      patch(model, "plan-parser@0.1", [{ op: "set", path: "vertices.v1", value: [1, 0] }], 0),
      since(model, 0, [{ revision: 1, touchedPaths: ["vertices.v1"], touchedOwners: ["vertices.v1"] }]),
    );
    expect(result.model.revision).toBe(1);
    expect(result.model.vertices.v1).toEqual([0, 0]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ path: "vertices.v1", reason: "conflict" }),
    ]);
    expect(result.model).toEqual(model);
  });

  it("rejects a schema-invalid outcome as a whole contract failure", () => {
    const model = structuredClone(smallModel);
    const result = apply(
      model,
      patch(model, "plan-parser@0.1", [{ op: "set", path: "flat.defaults.wallHeight", value: 0 }]),
      currentSince(model),
    );
    expect(result.model.revision).toBe(1);
    expect(result.model.flat.defaults.wallHeight).toBe(2.8);
    expect(result.rejected).toEqual([
      expect.objectContaining({ path: "flat.defaults.wallHeight", value: 0, reason: "contract" }),
    ]);
  });

  it("rejects grouped ops of a human owner together so value and meta stay paired", () => {
    const seeded = structuredClone(smallModel);
    seeded.walls.w1!.meta = { provenance: "human", basis: "declared", reviewed: true };
    const model = FlatModelSchema.parse(seeded);
    const result = apply(
      model,
      patch(model, "plan-parser@0.1", [
        { op: "set", path: "walls.w1.thickness", value: 0.5 },
        { op: "set", path: "walls.w1.meta", value: { provenance: "plan-parser@0.1", basis: "inferred" } },
        { op: "set", path: "rooms.r1.label", value: "Kept" },
      ]),
      currentSince(model),
    );
    expect(result.model.walls.w1?.thickness).toBe(0.2);
    expect(result.model.walls.w1?.meta.provenance).toBe("human");
    expect(result.model.rooms.r1?.label).toBe("Kept");
    expect(result.rejected).toEqual([
      expect.objectContaining({ path: "walls.w1.thickness", reason: "human" }),
      expect.objectContaining({ path: "walls.w1.meta", reason: "human" }),
    ]);
    expect(result.applied).toEqual([
      expect.objectContaining({ path: "rooms.r1.label" }),
    ]);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationReportSchema, type ValidationReport } from "@flatwalk/contract";
import { describe, expect, it } from "vitest";
import { door, parseModel, walkableTwoRooms } from "./fixtures.js";
import { DEFAULT_AVATAR, validate } from "./index.js";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/54541/flat.model.json");

function load54541() {
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}

function byId(report: ValidationReport, checkId: string) {
  return report.checks.find(check => check.checkId === checkId);
}

function fails(report: ValidationReport, prefix: string) {
  return report.checks.filter(check => check.checkId.startsWith(prefix) && check.status === "fail");
}

describe("validate public API", () => {
  it("never throws and always returns a Contract ValidationReport", () => {
    for (const input of [null, 1, "", {}, { schemaVersion: "9.9" }, load54541()]) {
      const report = validate(input);
      expect(() => ValidationReportSchema.parse(report)).not.toThrow();
    }
  });

  it("records the avatar profile but does not treat graph connectivity as physical clearance", () => {
    const report = validate(walkableTwoRooms(), DEFAULT_AVATAR);
    const clearance = byId(report, "navigation.clearance");
    expect(clearance?.status).toBe("skipped");
    expect(clearance?.message).toMatch(/0\.6/);
    expect(clearance?.message).toMatch(/0\.25/);
    expect(clearance?.message.toLowerCase()).toMatch(/граф|связн/);
  });
});

describe("54541 etalon", () => {
  it("is walkReady with unique entrance, polygons and graph reachability", () => {
    const report = validate(load54541());
    expect(report.modelId).toBe("cityexpert-54541");
    expect(report.revision).toBe(0);
    expect(report.schemaVersion).toBe("0.1");
    expect(byId(report, "contract.schema")?.status).toBe("pass");
    expect(byId(report, "geometry.graph")?.status).toBe("pass");
    expect(fails(report, "geometry.room-polygon")).toEqual([]);
    expect(fails(report, "geometry.opening")).toEqual([]);
    expect(byId(report, "consistency.entrance")?.status).toBe("pass");
    expect(fails(report, "navigation.reachable")).toEqual([]);
    expect(byId(report, "navigation.start")?.status).toBe("pass");
    expect(report.walkReady).toBe(true);
    expect(report.confirmation).toBeGreaterThan(0);
    expect(report.confirmation).toBeLessThan(1);
    expect(byId(report, "sources.files")?.status).toBe("unverified");
    expect(byId(report, "assets.files")?.status).toBe("unverified");
    expect(byId(report, "scale.evidence")?.status).toBe("unverified");
    expect(byId(report, "evidence.sources")?.status).toBe("unverified");
  });

  it("does not ask review for etalon terrace/loggia doors that are already passable:false", () => {
    const report = validate(load54541());
    expect(report.walkReady).toBe(true);
    expect(byId(report, "consistency.exterior-door-unmarked.o11")).toBeUndefined();
    expect(byId(report, "consistency.exterior-door-unmarked.o12")).toBeUndefined();
    expect(report.review.items.map(item => item.path)).not.toContain("openings.o11");
    expect(report.review.items.map(item => item.path)).not.toContain("openings.o12");
  });
});

describe("diagnostic failures", () => {
  it("marks a room without a door as unreachable and walkReady false", () => {
    const model = walkableTwoRooms({
      openings: { enter: door("w61", 1, 1, { entrance: true }) },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    const check = byId(report, "navigation.reachable.right");
    expect(check?.status).toBe("fail");
    expect(check?.layer).toBe("navigation");
    expect(check?.entities).toContain("rooms.right");
    expect(check?.message.length).toBeGreaterThan(8);
  });

  it("asks review for an exterior door that is neither entrance nor passable:false", () => {
    const model = walkableTwoRooms({
      openings: {
        d1: door("w25", 1, 1),
        enter: door("w61", 1, 1, { entrance: true }),
        terrace: door("w34", 1, 1),
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(true);
    expect(byId(report, "consistency.exterior-door-unmarked.terrace")?.status).toBe("fail");
    expect(report.review.items.some(item => item.path === "openings.terrace")).toBe(true);
  });

  it("rejects a missing entrance without throwing", () => {
    const model = walkableTwoRooms({
      openings: { d1: door("w25", 1, 1) },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    expect(byId(report, "consistency.entrance")?.status).toBe("fail");
    expect(byId(report, "consistency.entrance")?.message.toLowerCase()).toMatch(/вход/);
  });

  it("rejects two entrance flags", () => {
    const model = walkableTwoRooms({
      openings: {
        d1: door("w25", 1, 1),
        enter: door("w61", 1, 1, { entrance: true }),
        extra: door("w34", 1, 1, { entrance: true }),
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    expect(byId(report, "consistency.entrance")?.entities).toEqual(
      expect.arrayContaining(["openings.enter", "openings.extra"]),
    );
  });

  it("rejects an entrance on an interior wall", () => {
    const model = walkableTwoRooms({
      openings: {
        d1: door("w61", 1, 1),
        enter: door("w25", 1, 1, { entrance: true }),
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    expect(byId(report, "consistency.entrance")?.status).toBe("fail");
    expect(byId(report, "consistency.entrance")?.message.toLowerCase()).toMatch(/внешн/);
  });

  it("rejects an opening past the wall ends", () => {
    const model = walkableTwoRooms({
      openings: {
        d1: door("w25", 2.5, 1),
        enter: door("w61", 1, 1, { entrance: true }),
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    const check = byId(report, "geometry.opening-inside.d1");
    expect(check?.status).toBe("fail");
    expect(check?.entities).toContain("openings.d1");
    expect(check?.message).toMatch(/стен/);
  });

  it("rejects overlapping openings on one wall", () => {
    const model = walkableTwoRooms({
      openings: {
        d1: door("w25", 0.8, 1),
        d2: door("w25", 1.4, 1),
        enter: door("w61", 1, 1, { entrance: true }),
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    const check = byId(report, "geometry.opening-overlap.w25");
    expect(check?.status).toBe("fail");
    expect(check?.entities).toEqual(expect.arrayContaining(["openings.d1", "openings.d2"]));
  });

  it("rejects a door narrower than 0.6 m", () => {
    const model = walkableTwoRooms({
      openings: {
        d1: door("w25", 1, 0.4),
        enter: door("w61", 1, 1, { entrance: true }),
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    expect(byId(report, "geometry.opening-width.d1")?.status).toBe("fail");
    expect(byId(report, "geometry.opening-width.d1")?.message).toMatch(/0\.6/);
  });

  it("rejects an anchor without a room polygon", () => {
    const model = walkableTwoRooms({
      rooms: {
        left: { anchor: [2, 1.5], type: "living", label: "Left", meta: { provenance: "validator-test@0.1", basis: "inferred" } },
        right: { anchor: [4, 1.5], type: "bedroom", label: "Right", meta: { provenance: "validator-test@0.1", basis: "inferred" } },
      },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    expect(byId(report, "geometry.room-polygon.right")?.status).toBe("fail");
    expect(byId(report, "geometry.room-polygon.right")?.entities).toContain("rooms.right");
  });

  it("reports a Geometry Core nonplanar error without throwing", () => {
    const model = parseModel({
      ...walkableTwoRooms(),
      vertices: { a: [0, 0], b: [4, 4], c: [0, 4], d: [4, 0] },
      walls: {
        ab: { a: "a", b: "b", thickness: 0.2, exterior: true, meta: { provenance: "validator-test@0.1", basis: "inferred" } },
        cd: { a: "c", b: "d", thickness: 0.2, exterior: true, meta: { provenance: "validator-test@0.1", basis: "inferred" } },
      },
      openings: {},
      rooms: { r: { anchor: [2, 1], type: "unknown", label: "X", meta: { provenance: "validator-test@0.1", basis: "inferred" } } },
    });
    const report = validate(model);
    expect(report.walkReady).toBe(false);
    expect(byId(report, "geometry.graph")?.status).toBe("fail");
    expect(byId(report, "geometry.graph")?.message).toMatch(/nonplanar|пересеч|планар/i);
  });

  it("reports a Contract reference error without throwing", () => {
    const broken = structuredClone(walkableTwoRooms()) as Record<string, unknown>;
    const openings = broken.openings as Record<string, { wall: string }>;
    openings.d1.wall = "missing-wall";
    const report = validate(broken);
    expect(report.walkReady).toBe(false);
    expect(report.modelId).toBe("val-synth");
    expect(byId(report, "contract.schema")?.status).toBe("fail");
    expect(byId(report, "contract.schema")?.entities.some(path => path.startsWith("openings.d1"))).toBe(true);
    expect(byId(report, "geometry.graph")?.status).toBe("skipped");
  });

  it("computes confirmation from Meta owners instead of inventing a pass", () => {
    const report = validate(walkableTwoRooms());
    expect(report.confirmation).toBe(0);
    expect(report.walkReady).toBe(true);
  });
});

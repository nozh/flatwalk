import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "@flatwalk/builder";
import { PatchSchema, validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { adjacency, areas, faces, roomPolygon, startPoint } from "@flatwalk/geometry";
import { apply } from "@flatwalk/resolver";
import { AdapterError } from "./errors.js";
import { createGrokClient } from "./grok.js";
import {
  GROK_RECTS_CONFIDENCE,
  GROK_RECTS_FALLBACK_WHEN,
  GROK_RECTS_FIXTURE_ID,
  GROK_RECTS_MODULE,
  grokRectsPrompt,
  grokRectsResultSchema,
  parseGrokRectsResult,
  runGrokRects,
  type GrokRectsClient,
} from "./grok-rects.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const META = { provenance: "importer@0.1", basis: "assumed" as const };

function emptyModel(id = "synthetic-rects"): FlatModel {
  return {
    schemaVersion: "0.1",
    id,
    revision: 0,
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
    vertices: {},
    walls: {},
    openings: {},
    rooms: {},
    assets: {},
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

function grokClient(content: string, extra?: { synthetic?: boolean; note?: string }): GrokRectsClient {
  return {
    mode: "fixture",
    chatCompletions: async () => ({
      synthetic: extra?.synthetic ?? true,
      note: extra?.note,
      body: {
        choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      },
    }),
  };
}

const THREE_ROOMS = {
  rooms: [
    { id: "r1", type: "living", rect: [0, 0, 12, 6] },
    { id: "r2", type: "hall", rect: [0, 6, 6, 6] },
    { id: "r3", type: "bedroom", rect: [6, 6, 6, 6] },
  ],
  doors: [{ between: ["r1", "r2"] }, { between: ["r2", "r3"] }],
  entrance: "r2",
};

describe("grok-rects AI result schema", () => {
  it("accepts the documented rectangle payload and rejects a FlatModel-shaped object", () => {
    expect(parseGrokRectsResult(THREE_ROOMS).ok).toBe(true);
    const asModel = parseGrokRectsResult({
      schemaVersion: "0.1",
      id: "synthetic",
      rooms: { r1: { anchor: [1, 1] } },
    });
    expect(asModel.ok).toBe(false);
    expect(grokRectsResultSchema).toBeTypeOf("object");
  });
});

describe("grok-rects prompt", () => {
  it("asks for a 0.5 m grid, room types, door links and an entrance room", () => {
    const prompt = grokRectsPrompt();
    expect(prompt.system).toMatch(/0\.5/ );
    expect(prompt.user).toMatch(/rect/i);
    expect(prompt.user).toMatch(/between/);
    expect(prompt.user).toMatch(/entrance/);
    expect(prompt.user).toMatch(/living|bedroom|hall/);
  });
});

describe("runGrokRects", () => {
  it("turns the packaged three-room fixture into a patch that Resolver, Contract and Geometry Core accept", async () => {
    const model = emptyModel("cityexpert-rects");
    const result = await runGrokRects({
      model,
      plan: { imageUrl: "https://example.test/plan.png" },
      grok: createGrokClient({
        mode: "fixture",
        transport: async () => {
          throw new Error("network must not be used for the packaged fixture");
        },
      }),
    });

    expect(result.patch).not.toBeNull();
    expect(result.patch?.module).toBe(GROK_RECTS_MODULE);
    expect(result.patch?.modelId).toBe(model.id);
    expect(result.patch?.baseRevision).toBe(0);
    expect(result.patch?.schemaVersion).toBe("0.1");
    expect(PatchSchema.safeParse(result.patch).success).toBe(true);
    expect(result.diagnostics.synthetic).toBe(true);
    expect(result.diagnostics.overlay.status).toBe("blocked");
    expect(result.diagnostics.overlay.dependency).toBe("builder.renderOverlay");

    const applied = apply(model, result.patch!, currentSince(model));
    expect(applied.rejected).toEqual([]);
    expect(applied.model.revision).toBe(1);
    expect(applied.model).not.toBe(model);

    const contract = validateFlatModel(applied.model);
    expect(contract.success).toBe(true);

    expect(faces(applied.model)).toHaveLength(3);
    expect(roomPolygon(applied.model, "r1")).not.toBeNull();
    expect(roomPolygon(applied.model, "r2")).not.toBeNull();
    expect(roomPolygon(applied.model, "r3")).not.toBeNull();
    expect(areas(applied.model).rooms.r1).toBeCloseTo(18, 5);
    expect(areas(applied.model).rooms.r2).toBeCloseTo(9, 5);
    expect(areas(applied.model).rooms.r3).toBeCloseTo(9, 5);

    const pairs = adjacency(applied.model)
      .map((edge) => [...edge.rooms].sort().join("-"))
      .sort();
    expect(pairs).toEqual(["r1-r2", "r2-r3"]);
    expect(applied.model.openings).not.toHaveProperty("fake");

    const tee = Object.values(applied.model.vertices).some(
      (point) => Math.abs(point[0] - 3) < 1e-9 && Math.abs(point[1] - 3) < 1e-9,
    );
    expect(tee).toBe(true);
    const unsplitBase = Object.values(applied.model.walls).filter((wall) => {
      const a = applied.model.vertices[wall.a];
      const b = applied.model.vertices[wall.b];
      return (
        Math.abs(a[1] - 3) < 1e-9 &&
        Math.abs(b[1] - 3) < 1e-9 &&
        Math.abs(Math.abs(a[0] - b[0]) - 6) < 1e-9
      );
    });
    expect(unsplitBase).toHaveLength(0);

    const interior = Object.values(applied.model.walls).filter((wall) => !wall.exterior);
    expect(interior.length).toBeGreaterThanOrEqual(3);

    expect(applied.model.plan.meta.basis).toBe("assumed");
    expect(applied.model.plan.meta.confidence).toBe(GROK_RECTS_CONFIDENCE);
    expect(applied.model.plan.pxPerMeter).toBeUndefined();
    expect(applied.model.rooms.r1?.meta.provenance).toBe(GROK_RECTS_MODULE);
    expect(applied.model.rooms.r1?.meta.basis).toBe("assumed");
    expect(applied.model.rooms.r1?.meta.confidence).toBe(GROK_RECTS_CONFIDENCE);

    const entrances = Object.values(applied.model.openings).filter(
      (opening) => opening.kind === "door" && opening.entrance,
    );
    expect(entrances).toHaveLength(1);
    expect(applied.model.walls[entrances[0]!.wall]?.exterior).toBe(true);
    expect(startPoint(applied.model).point).toHaveLength(2);

    const scene = build(applied.model);
    expect(scene.name).toBe("flat:cityexpert-rects");
    expect(scene.children.length).toBeGreaterThan(0);
  });

  it("refuses fully separated rectangles that Geometry Core maps ambiguously", async () => {
    const model = emptyModel();
    const result = await runGrokRects({
      model,
      grok: grokClient(
        JSON.stringify({
          rooms: [
            { id: "r1", type: "living", rect: [0, 0, 8, 8] },
            { id: "r2", type: "bedroom", rect: [12, 12, 8, 8] },
          ],
          doors: [{ between: ["r1", "r2"] }],
          entrance: "r1",
        }),
      ),
    });

    expect(result.patch).toBeNull();
    expect(result.reason).toMatch(/incompatible-geometry|ambiguous-mapping/);
    expect(result.diagnostics.geometryError).toMatchObject({
      code: "ambiguous-mapping",
    });
    expect(result.diagnostics.geometryError?.entities?.some((id) => id.includes("r2"))).toBe(true);
    expect(result.diagnostics.droppedDoors).toEqual(
      expect.arrayContaining([expect.objectContaining({ between: ["r1", "r2"] })]),
    );
  });

  it("refuses intersecting rectangles instead of inventing a walkable graph", async () => {
    const result = await runGrokRects({
      model: emptyModel(),
      grok: grokClient(
        JSON.stringify({
          rooms: [
            { id: "r1", type: "living", rect: [0, 0, 8, 8] },
            { id: "r2", type: "bedroom", rect: [4, 4, 8, 8] },
          ],
          doors: [{ between: ["r1", "r2"] }],
          entrance: "r1",
        }),
      ),
    });
    expect(result.patch).toBeNull();
    expect(result.reason).toMatch(/intersect/i);
    expect(result.diagnostics.intersectingRooms?.length).toBeGreaterThan(0);
  });

  it("drops a door without a shared edge of 0.8 m and writes meta.question, without a fake opening", async () => {
    const result = await runGrokRects({
      model: emptyModel(),
      grok: grokClient(
        JSON.stringify({
          rooms: [
            { id: "r1", type: "living", rect: [0, 0, 8, 8] },
            { id: "r2", type: "bedroom", rect: [8, 8, 8, 8] },
          ],
          doors: [{ between: ["r1", "r2"] }],
          entrance: "r1",
        }),
      ),
    });
    expect(result.patch).not.toBeNull();
    const applied = apply(emptyModel(), result.patch!, currentSince(emptyModel()));
    expect(applied.rejected).toEqual([]);
    const interiorDoors = Object.values(applied.model.openings).filter(
      (opening) => opening.kind === "door" && !opening.entrance,
    );
    expect(interiorDoors).toHaveLength(0);
    expect(applied.model.rooms.r1?.meta.question).toMatch(/door|стен|грани|adjacent/i);
    expect(applied.model.rooms.r2?.meta.question).toBeTruthy();
    expect(adjacency(applied.model)).toEqual([]);
    expect(result.diagnostics.droppedDoors).toEqual(
      expect.arrayContaining([expect.objectContaining({ between: ["r1", "r2"] })]),
    );
  });

  it("returns a clear diagnostic for invalid JSON and does not emit a patch", async () => {
    const result = await runGrokRects({
      model: emptyModel(),
      grok: grokClient("this is not json {"),
    });
    expect(result.patch).toBeNull();
    expect(result.reason).toMatch(/json/i);
    expect(result.diagnostics.schemaErrors?.length).toBeGreaterThan(0);
  });

  it("fails closed when the fixture is missing instead of calling the network", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-rects-"));
    tmpDirs.push(dir);
    const calls: string[] = [];
    await expect(
      runGrokRects({
        model: emptyModel(),
        grok: createGrokClient({
          mode: "fixture",
          fixtureDir: dir,
          transport: async (request) => {
            calls.push(request.url);
            return { status: 200, headers: {}, body: "{}" };
          },
        }),
        fixtureId: "grok/does-not-exist",
      }),
    ).rejects.toMatchObject({ code: "missing-fixture" });
    expect(calls).toEqual([]);
    expect(() => {
      throw new AdapterError("missing-fixture", "probe");
    }).not.toThrow(TypeError);
  });

  it("requires the source model as an argument and copies modelId/baseRevision from it", async () => {
    const model = emptyModel("listing-54541");
    model.revision = 3;
    const result = await runGrokRects({
      model,
      grok: grokClient(JSON.stringify(THREE_ROOMS)),
    });
    expect(result.patch?.modelId).toBe("listing-54541");
    expect(result.patch?.baseRevision).toBe(3);
  });

  it("documents when the caller should enable this fallback", () => {
    expect(GROK_RECTS_FALLBACK_WHEN).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/patch:\s*null/i),
        expect.stringMatching(/60/ ),
        expect.stringMatching(/Геометр|geometry/i),
        expect.stringMatching(/PARSER_URL/),
      ]),
    );
    expect(GROK_RECTS_FIXTURE_ID).toBe("grok/grok-rects.synthetic");
  });
});

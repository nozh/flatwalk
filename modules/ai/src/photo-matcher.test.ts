import { describe, expect, it } from "vitest";
import { PatchSchema, validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { apply } from "@flatwalk/resolver";
import { AdapterError } from "./errors.js";
import { createGrokClient } from "./grok.js";
import {
  PHOTO_MATCHER_FIXTURE_ID,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  PHOTO_MATCHER_MODULE,
  PHOTO_MATCHER_PROMPT_VERSION,
  parseGrokPhotoMatcherResult,
  photoMatcherPrompt,
  photoMatcherResultSchema,
  runPhotoMatcher,
  type PhotoMatcherClient,
} from "./photo-matcher.js";

const META = { provenance: "importer@0.1", basis: "assumed" as const };

function twoRoomModel(over: Partial<FlatModel> = {}): FlatModel {
  return {
    schemaVersion: "0.1",
    id: "cityexpert-matcher",
    revision: 3,
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
      w1: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { ...META, basis: "inferred" } },
      w2: { a: "v2", b: "v3", thickness: 0.2, exterior: true, meta: { ...META, basis: "inferred" } },
      w3: { a: "v3", b: "v4", thickness: 0.2, exterior: true, meta: { ...META, basis: "inferred" } },
      w4: { a: "v4", b: "v5", thickness: 0.2, exterior: true, meta: { ...META, basis: "inferred" } },
      w5: { a: "v5", b: "v6", thickness: 0.2, exterior: true, meta: { ...META, basis: "inferred" } },
      w6: { a: "v6", b: "v1", thickness: 0.2, exterior: true, meta: { ...META, basis: "inferred" } },
      w7: { a: "v2", b: "v5", thickness: 0.2, exterior: false, meta: { ...META, basis: "inferred" } },
    },
    openings: {
      o1: {
        kind: "door",
        wall: "w6",
        at: 1,
        width: 0.9,
        entrance: true,
        meta: { ...META, basis: "inferred" },
      },
      o2: {
        kind: "door",
        wall: "w7",
        at: 1,
        width: 0.9,
        meta: { ...META, basis: "inferred" },
      },
    },
    rooms: {
      r1: { anchor: [2, 1.5], type: "bedroom", label: "Bedroom A", meta: { ...META, basis: "inferred" } },
      r2: { anchor: [6, 1.5], type: "bedroom", label: "Bedroom B", meta: { ...META, basis: "inferred" } },
    },
    assets: {
      plan: { kind: "plan", url: "materials/plan.png", width: 100, height: 80, meta: { ...META } },
      p1: {
        kind: "photo",
        url: "materials/p1.jpg",
        width: 800,
        height: 600,
        room: null,
        faces: null,
        meta: { ...META },
      },
      p2: {
        kind: "photo",
        url: "materials/p2.jpg",
        width: 800,
        height: 600,
        room: null,
        faces: null,
        meta: { ...META },
      },
      p3: {
        kind: "photo",
        url: "materials/p3.jpg",
        width: 800,
        height: 600,
        room: null,
        faces: null,
        meta: { ...META },
      },
    },
    ...over,
  };
}

function modelWithFacade(): FlatModel {
  const model = twoRoomModel();
  model.assets["p-facade"] = {
    kind: "photo",
    url: "materials/facade.jpg",
    width: 800,
    height: 600,
    room: "r1",
    faces: "w1",
    look: { floor: "parquet", wallTone: "light" },
    meta: { provenance: PHOTO_MATCHER_MODULE, basis: "inferred", confidence: 0.8 },
  };
  return model;
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

function grokClient(content: string, extra?: { synthetic?: boolean; note?: string }): PhotoMatcherClient {
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

const VALID_PHOTOS = {
  photos: [
    { assetId: "p3", roomId: "r1", wallId: "w1", confidence: 0.82, floor: "parquet", wallTone: "light" },
  ],
};

describe("photo-matcher provider schema", () => {
  it("accepts the documented photos payload and rejects a FlatModel-shaped object", () => {
    expect(parseGrokPhotoMatcherResult(VALID_PHOTOS).ok).toBe(true);
    const asModel = parseGrokPhotoMatcherResult({
      schemaVersion: "0.1",
      id: "synthetic",
      photos: { p3: { room: "r1" } },
    });
    expect(asModel.ok).toBe(false);
    expect(photoMatcherResultSchema).toBeTypeOf("object");
  });
});

describe("photo-matcher prompt", () => {
  it("asks for overlay, allowed room/wall ids, floor and wallTone", () => {
    const prompt = photoMatcherPrompt({
      rooms: [
        { id: "r1", type: "bedroom" },
        { id: "r2", type: "bedroom" },
      ],
      walls: ["w1", "w7"],
      photoIds: ["p1", "p2"],
    });
    expect(prompt.system).toMatch(/overlay|plan/i);
    expect(prompt.user).toMatch(/r1/);
    expect(prompt.user).toMatch(/w1/);
    expect(prompt.user).toMatch(/p1/);
    expect(prompt.user).toMatch(/parquet|tile|laminate/);
    expect(prompt.user).toMatch(/light|dark|colored/);
    expect(prompt.user).toMatch(/roomId/);
    expect(prompt.user).toMatch(/null/);
  });
});

describe("runPhotoMatcher", () => {
  it("turns a schema-valid Grok answer into a Contract patch with modelId/baseRevision from the accepted model", async () => {
    const model = twoRoomModel();
    const result = await runPhotoMatcher({
      model,
      overlay: { imageUrl: "https://example.test/overlay-rev-003.png" },
      photos: [{ assetId: "p3", imageUrl: "https://example.test/p3.jpg" }],
      grok: grokClient(JSON.stringify(VALID_PHOTOS)),
    });

    expect(result.patch).not.toBeNull();
    expect(result.patch?.module).toBe(PHOTO_MATCHER_MODULE);
    expect(result.patch?.modelId).toBe(model.id);
    expect(result.patch?.baseRevision).toBe(3);
    expect(PatchSchema.safeParse(result.patch).success).toBe(true);
    expect(result.diagnostics.promptVersion).toBe(PHOTO_MATCHER_PROMPT_VERSION);
    expect(result.diagnostics.liveApiCalled).toBe(false);
    expect(result.diagnostics.raw).toBeTruthy();

    const applied = apply(model, result.patch!, currentSince(model));
    expect(applied.rejected).toEqual([]);
    expect(applied.model.assets.p3).toMatchObject({
      room: "r1",
      faces: "w1",
      look: { floor: "parquet", wallTone: "light" },
    });
    expect(applied.model.assets.p3?.meta.confidence).toBe(0.82);
    expect(applied.model.vertices).toEqual(model.vertices);
    expect(applied.model.walls).toEqual(model.walls);
    expect(validateFlatModel(applied.model).success).toBe(true);
  });

  it("drops foreign asset/room/wall ids with diagnostics and keeps valid photos", async () => {
    const model = twoRoomModel();
    const result = await runPhotoMatcher({
      model,
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: grokClient(
        JSON.stringify({
          photos: [
            { assetId: "ghost", roomId: "r1", wallId: "w1", confidence: 0.9, floor: "tile", wallTone: "dark" },
            { assetId: "p1", roomId: "r99", wallId: "w1", confidence: 0.9, floor: "tile", wallTone: "dark" },
            { assetId: "p2", roomId: "r2", wallId: "w-missing", confidence: 0.9, floor: "tile", wallTone: "dark" },
            { assetId: "p3", roomId: "r1", wallId: "w1", confidence: 0.77, floor: "parquet", wallTone: "light" },
          ],
        }),
      ),
    });

    expect(result.patch).not.toBeNull();
    const paths = result.patch!.ops.map((op) => op.path);
    expect(paths.some((path) => path.startsWith("assets.ghost"))).toBe(false);
    expect(paths.some((path) => path.startsWith("assets.p1"))).toBe(false);
    expect(paths).toEqual(expect.arrayContaining(["assets.p2.room", "assets.p2.faces", "assets.p3.room"]));
    const facesOp = result.patch!.ops.find((op) => op.op === "set" && op.path === "assets.p2.faces");
    expect(facesOp).toMatchObject({ op: "set", value: null });
    expect(result.diagnostics.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "unknown-asset" }),
        expect.objectContaining({ reason: "unknown-room" }),
        expect.objectContaining({ reason: "unknown-wall" }),
      ]),
    );
  });

  it("does not invent a wall when the reported wall is not on the chosen room", async () => {
    const model = twoRoomModel();
    const result = await runPhotoMatcher({
      model,
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: grokClient(
        JSON.stringify({
          photos: [
            { assetId: "p1", roomId: "r1", wallId: "w3", confidence: 0.91, floor: "parquet", wallTone: "light" },
          ],
        }),
      ),
    });
    const facesOp = result.patch!.ops.find((op) => op.op === "set" && op.path === "assets.p1.faces");
    const roomOp = result.patch!.ops.find((op) => op.op === "set" && op.path === "assets.p1.room");
    expect(roomOp).toMatchObject({ value: "r1" });
    expect(facesOp).toMatchObject({ value: null });
    expect(result.diagnostics.dropped).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "wall-not-on-room", assetId: "p1" })]),
    );
  });

  it("clears a previous room/faces binding when Grok returns roomId null", async () => {
    const model = modelWithFacade();
    const result = await runPhotoMatcher({
      model,
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: grokClient(
        JSON.stringify({
          photos: [
            {
              assetId: "p-facade",
              roomId: null,
              wallId: "w1",
              confidence: 0.4,
              floor: "unknown",
              wallTone: "colored",
            },
          ],
        }),
      ),
    });
    const applied = apply(model, result.patch!, currentSince(model));
    expect(applied.rejected).toEqual([]);
    expect(applied.model.assets["p-facade"]).toMatchObject({ room: null, faces: null });
    expect(applied.model.assets["p-facade"]?.meta.confidence).toBe(0);
    expect(applied.model.assets["p-facade"]?.meta.question).toBeTruthy();
    const roomOp = result.patch!.ops.find((op) => op.path === "assets.p-facade.room");
    const facesOp = result.patch!.ops.find((op) => op.path === "assets.p-facade.faces");
    expect(roomOp).toMatchObject({ op: "set", value: null });
    expect(facesOp).toMatchObject({ op: "set", value: null });
  });

  it("keeps low confidence for two similar bedrooms instead of inflating it", async () => {
    const model = twoRoomModel();
    const result = await runPhotoMatcher({
      model,
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: grokClient(
        JSON.stringify({
          photos: [
            { assetId: "p1", roomId: "r1", wallId: "w1", confidence: 0.45, floor: "parquet", wallTone: "light" },
            { assetId: "p2", roomId: "r2", wallId: "w3", confidence: 0.41, floor: "parquet", wallTone: "light" },
          ],
        }),
      ),
    });
    const applied = apply(model, result.patch!, currentSince(model));
    expect(applied.model.assets.p1?.meta.confidence).toBe(0.45);
    expect(applied.model.assets.p2?.meta.confidence).toBe(0.41);
    expect(applied.model.assets.p1?.meta.confidence).toBeLessThan(PHOTO_MATCHER_LOW_CONFIDENCE);
    expect(applied.model.assets.p1?.meta.question).toBeTruthy();
    expect(applied.model.assets.p2?.meta.question).toBeTruthy();
  });

  it("lets Resolver keep a human photo binding on a rematch", async () => {
    const seed = twoRoomModel();
    const first = await runPhotoMatcher({
      model: seed,
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: grokClient(
        JSON.stringify({
          photos: [{ assetId: "p1", roomId: "r1", wallId: "w1", confidence: 0.8, floor: "parquet", wallTone: "light" }],
        }),
      ),
    });
    const afterMatch = apply(seed, first.patch!, currentSince(seed));
    const editor = apply(
      afterMatch.model,
      {
        schemaVersion: "0.1",
        modelId: seed.id,
        baseRevision: afterMatch.model.revision,
        module: "editor@0.1",
        ops: [
          { op: "set", path: "assets.p1.room", value: "r2" },
          { op: "set", path: "assets.p1.faces", value: "w3" },
          {
            op: "set",
            path: "assets.p1.meta",
            value: { provenance: "human", basis: "declared", reviewed: true },
          },
        ],
      },
      {
        schemaVersion: "0.1",
        modelId: seed.id,
        baseRevision: afterMatch.model.revision,
        currentRevision: afterMatch.model.revision,
        changes: [],
      },
    );
    expect(editor.model.assets.p1).toMatchObject({ room: "r2", faces: "w3" });
    expect(editor.model.assets.p1?.meta.provenance).toBe("human");

    const rematch = await runPhotoMatcher({
      model: editor.model,
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: grokClient(
        JSON.stringify({
          photos: [{ assetId: "p1", roomId: "r1", wallId: "w1", confidence: 0.95, floor: "parquet", wallTone: "light" }],
        }),
      ),
    });
    expect(rematch.patch?.ops.some((op) => op.path === "assets.p1.room")).toBe(true);

    const protectedApply = apply(editor.model, rematch.patch!, {
      schemaVersion: "0.1",
      modelId: seed.id,
      baseRevision: editor.model.revision,
      currentRevision: editor.model.revision,
      changes: [],
    });
    expect(protectedApply.rejected.some((item) => item.reason === "human" && item.path.startsWith("assets.p1"))).toBe(
      true,
    );
    expect(protectedApply.model.assets.p1).toMatchObject({ room: "r2", faces: "w3" });
    expect(protectedApply.model.assets.p1?.meta.provenance).toBe("human");
  });

  it("requires an explicit overlay argument", async () => {
    await expect(
      runPhotoMatcher({
        model: twoRoomModel(),
        grok: grokClient(JSON.stringify(VALID_PHOTOS)),
      } as never),
    ).rejects.toThrow(/overlay/i);
  });

  it("sends overlay plus every photo in one Grok call", async () => {
    const captured: unknown[] = [];
    const grok: PhotoMatcherClient = {
      mode: "fixture",
      chatCompletions: async (request) => {
        captured.push(request.messages);
        return {
          synthetic: true,
          body: {
            choices: [{ message: { role: "assistant", content: JSON.stringify(VALID_PHOTOS) }, finish_reason: "stop" }],
          },
        };
      },
    };
    await runPhotoMatcher({
      model: twoRoomModel(),
      overlay: { imageUrl: "https://example.test/overlay-rev-003.png" },
      photos: [
        { assetId: "p1", imageUrl: "https://example.test/p1.jpg" },
        { assetId: "p2", imageUrl: "https://example.test/p2.jpg" },
      ],
      grok,
      timeoutMs: 45_000,
    });
    const blob = JSON.stringify(captured);
    expect(blob).toContain("https://example.test/overlay-rev-003.png");
    expect(blob).toContain("https://example.test/p1.jpg");
    expect(blob).toContain("https://example.test/p2.jpg");
    expect(captured).toHaveLength(1);
  });

  it("forwards a bounded timeout to the existing Grok client", async () => {
    let timeoutMs: number | undefined;
    const grok: PhotoMatcherClient = {
      mode: "fixture",
      chatCompletions: async (request) => {
        timeoutMs = request.timeoutMs;
        return {
          synthetic: true,
          body: {
            choices: [{ message: { role: "assistant", content: JSON.stringify(VALID_PHOTOS) }, finish_reason: "stop" }],
          },
        };
      },
    };
    await runPhotoMatcher({
      model: twoRoomModel(),
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok,
      timeoutMs: 12_000,
    });
    expect(timeoutMs).toBe(12_000);
  });

  it("uses the packaged synthetic fixture through createGrokClient", async () => {
    const result = await runPhotoMatcher({
      model: twoRoomModel(),
      overlay: { imageUrl: "https://example.test/overlay.png" },
      grok: createGrokClient({
        mode: "fixture",
        transport: async () => {
          throw new Error("network must not be used");
        },
      }),
    });
    expect(result.diagnostics.synthetic).toBe(true);
    expect(result.diagnostics.fixtureId).toBe(PHOTO_MATCHER_FIXTURE_ID);
    expect(result.patch?.ops.some((op) => op.path === "assets.p3.room")).toBe(true);
  });

  it("fails closed when the fixture is missing", async () => {
    await expect(
      runPhotoMatcher({
        model: twoRoomModel(),
        overlay: { imageUrl: "https://example.test/overlay.png" },
        grok: createGrokClient({
          mode: "fixture",
          fixtureDir: "/tmp/flatwalk-missing-matcher-fixtures",
          transport: async () => ({ status: 200, headers: {}, body: "{}" }),
        }),
        fixtureId: "grok/does-not-exist",
      }),
    ).rejects.toMatchObject({ code: "missing-fixture" });
    expect(() => {
      throw new AdapterError("missing-fixture", "probe");
    }).not.toThrow(TypeError);
  });
});

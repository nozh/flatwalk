import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PatchSchema, validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { renderOverlay } from "@flatwalk/builder/node";
import { apply } from "@flatwalk/resolver";
import { validate } from "@flatwalk/validator";
import { createGrokClient } from "./grok.js";
import {
  PHOTO_MATCHER_54541_FIXTURE_ID,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  PHOTO_MATCHER_MODULE,
  runPhotoMatcher,
} from "./photo-matcher.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const listingDir = path.join(repoRoot, "fixtures/54541");
const modelPath = path.join(listingDir, "flat.model.json");

async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function loadManual54541(): Promise<FlatModel> {
  return JSON.parse(await readFile(modelPath, "utf8")) as FlatModel;
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

describe("54541 photo-matcher integration (manual geometry)", () => {
  it("renders an aligned overlay from the accepted revision and original PNG via @flatwalk/builder/node", async () => {
    const model = await loadManual54541();
    const planPng = await readFile(path.join(listingDir, "plan.png"));
    const overlay = await renderOverlay(model, planPng);

    expect(model.id).toBe("cityexpert-54541");
    expect(overlay.meta.modelId).toBe(model.id);
    expect(overlay.meta.revision).toBe(model.revision);
    expect(overlay.meta.kind).toBe("aligned");
    expect(overlay.meta.pxPerMeter).toBeCloseTo(66.123, 3);
    expect(overlay.meta.width).toBe(940);
    expect(overlay.meta.height).toBe(786);
    expect(overlay.png.byteLength).toBeGreaterThan(1000);
    expect(overlay.schemePng).toBeUndefined();
    expect(overlay.meta.ids.rooms).toEqual(expect.arrayContaining(["r1", "r10"]));
    expect(overlay.meta.ids.walls).toEqual(expect.arrayContaining(["w7", "w31"]));
  });

  it("turns the explicit synthetic 54541 fixture into a patch whose IDs exist on the manual model", async () => {
    const model = await loadManual54541();
    const overlay = await renderOverlay(model, await readFile(path.join(listingDir, "plan.png")));
    const photoNames = Array.from({ length: 17 }, (_, i) => `photo-${String(i + 1).padStart(2, "0")}.jpg`);
    const photos = await Promise.all(
      photoNames.map(async (name, index) => ({
        assetId: `p${index + 1}`,
        imageBase64: (await readFile(path.join(listingDir, "photos", name))).toString("base64"),
      })),
    );
    expect(photos).toHaveLength(17);

    const result = await runPhotoMatcher({
      model,
      overlay: { imageBase64: Buffer.from(overlay.png).toString("base64") },
      photos,
      grok: createGrokClient({
        mode: "fixture",
        transport: async () => {
          throw new Error("network must not be used for the 54541 synthetic fixture");
        },
      }),
      fixtureId: PHOTO_MATCHER_54541_FIXTURE_ID,
    });

    expect(result.diagnostics.synthetic).toBe(true);
    expect(result.diagnostics.liveApiCalled).toBe(false);
    expect(result.diagnostics.fixtureId).toBe(PHOTO_MATCHER_54541_FIXTURE_ID);
    expect(result.patch).not.toBeNull();
    expect(result.patch?.modelId).toBe("cityexpert-54541");
    expect(result.patch?.baseRevision).toBe(model.revision);
    expect(result.patch?.module).toBe(PHOTO_MATCHER_MODULE);
    expect(PatchSchema.safeParse(result.patch).success).toBe(true);

    const reasons = result.diagnostics.dropped.map((item) => item.reason);
    expect(reasons).toEqual(expect.arrayContaining(["unknown-asset", "unknown-room", "wall-not-on-room"]));
    expect(result.patch!.ops.some((op) => op.path.startsWith("assets.ghost"))).toBe(false);
    expect(result.patch!.ops.some((op) => op.path.startsWith("assets.p4"))).toBe(false);

    const applied = apply(model, result.patch!, currentSince(model));
    expect(applied.rejected).toEqual([]);
    expect(applied.model.id).toBe(model.id);
    expect(applied.model.revision).toBe(model.revision + 1);
    expect(applied.model.vertices).toEqual(model.vertices);
    expect(applied.model.walls).toEqual(model.walls);
    expect(applied.model.rooms).toEqual(model.rooms);
    expect(validateFlatModel(applied.model).success).toBe(true);

    expect(applied.model.assets.p17).toMatchObject({ room: null, faces: null });
    expect(applied.model.assets.p5).toMatchObject({ room: "r2", faces: null });
    expect(applied.model.assets.p8?.meta.confidence).toBeLessThan(PHOTO_MATCHER_LOW_CONFIDENCE);
    expect(applied.model.assets.p12?.meta.confidence).toBeLessThan(PHOTO_MATCHER_LOW_CONFIDENCE);
    expect(applied.model.assets.p9).toMatchObject({ room: model.assets.p9?.room, faces: model.assets.p9?.faces });

    const report = validate(applied.model);
    expect(report.modelId).toBe(model.id);
    expect(report.revision).toBe(applied.model.revision);
    const lowConfidencePhotos = ["p8", "p11", "p12", "p17"];
    const reviewPaths = report.review.items.map((item) => item.path);
    expect(
      lowConfidencePhotos.every((id) => !reviewPaths.includes(`assets.${id}`)),
    ).toBe(true);
  });

  it("lets Resolver keep a human binding on a clone without rewriting the accepted reference file", async () => {
    const before = await sha256File(modelPath);
    const model = await loadManual54541();
    const overlay = await renderOverlay(model, await readFile(path.join(listingDir, "plan.png")));
    const clone: FlatModel = JSON.parse(JSON.stringify(model));
    clone.assets.p1 = {
      ...clone.assets.p1!,
      meta: { provenance: "human", basis: "declared", reviewed: true, confidence: 0.99 },
    };

    const result = await runPhotoMatcher({
      model: clone,
      overlay: { imageBase64: Buffer.from(overlay.png).toString("base64") },
      grok: createGrokClient({
        mode: "fixture",
        transport: async () => {
          throw new Error("network must not be used");
        },
      }),
      fixtureId: PHOTO_MATCHER_54541_FIXTURE_ID,
    });
    expect(result.patch?.ops.some((op) => op.path === "assets.p1.room")).toBe(true);

    const protectedApply = apply(clone, result.patch!, currentSince(clone));
    expect(protectedApply.rejected.some((item) => item.reason === "human" && item.path.startsWith("assets.p1"))).toBe(
      true,
    );
    expect(protectedApply.model.assets.p1).toMatchObject({ room: clone.assets.p1?.room, faces: clone.assets.p1?.faces });
    expect(protectedApply.model.assets.p1?.meta.provenance).toBe("human");

    expect(await sha256File(modelPath)).toBe(before);
    expect((await stat(modelPath)).isFile()).toBe(true);
  });
});

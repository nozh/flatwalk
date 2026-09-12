import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PatchSchema, validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { apply } from "@flatwalk/resolver";
import { validate } from "@flatwalk/validator";
import { createGrokClient } from "./grok.js";
import { PHOTO_MATCHER_MODULE, runPhotoMatcher } from "./photo-matcher.js";
import { DRESSER_MODULE, runDresserL1 } from "./dresser.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const listingDir = path.join(repoRoot, "fixtures/54541");
const modelPath = path.join(listingDir, "flat.model.json");
const liveMatcherPath = path.join(repoRoot, "modules/ai/fixtures/grok/photo-matcher.54541.live.json");

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
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

const LIVE_ROOM_FLOORS: Record<string, { floor: "parquet" | "tile"; source: string }> = {
  r1: { floor: "parquet", source: "look-mode" },
  r2: { floor: "parquet", source: "type-fallback" },
  r3: { floor: "parquet", source: "look-mode" },
  r4: { floor: "parquet", source: "look-mode" },
  r5: { floor: "tile", source: "look-mode" },
  r6: { floor: "parquet", source: "look-mode" },
  r7: { floor: "tile", source: "look-mode" },
  r8: { floor: "parquet", source: "type-fallback" },
  r9: { floor: "parquet", source: "look-mode" },
  r10: { floor: "parquet", source: "look-mode" },
};

describe("54541 Dresser L1 offline live Matcher replay", () => {
  it("applies saved live Matcher then L1 on a clone without rewriting the reference files", async () => {
    const beforeModel = await sha256File(modelPath);
    const beforeLive = await sha256File(liveMatcherPath);
    const original = JSON.parse(await readFile(modelPath, "utf8")) as FlatModel;
    const clone: FlatModel = structuredClone(original);

    const matcher = await runPhotoMatcher({
      model: clone,
      overlay: { imageUrl: "data:image/png;base64,AA==" },
      grok: createGrokClient({
        mode: "fixture",
        transport: async () => {
          throw new Error("network must not be used for the saved live Matcher envelope");
        },
      }),
      fixtureId: "grok/photo-matcher.54541.live",
    });
    expect(matcher.diagnostics.liveApiCalled).toBe(false);
    expect(matcher.diagnostics.synthetic).toBe(false);
    expect(matcher.patch).not.toBeNull();
    expect(matcher.patch?.module).toBe(PHOTO_MATCHER_MODULE);

    const matched = apply(clone, matcher.patch!, currentSince(clone));
    expect(matched.rejected).toEqual([]);
    expect(matched.model.vertices).toEqual(original.vertices);
    expect(matched.model.walls).toEqual(original.walls);
    expect(matched.model.openings).toEqual(original.openings);

    const dressed = runDresserL1({ model: matched.model });
    expect(dressed.diagnostics.liveApiCalled).toBe(false);
    expect(dressed.patch.module).toBe(DRESSER_MODULE);
    expect(dressed.patch.modelId).toBe("cityexpert-54541");
    expect(dressed.patch.baseRevision).toBe(matched.model.revision);
    expect(PatchSchema.safeParse(dressed.patch).success).toBe(true);
    expect(dressed.patch.ops.every((op) => op.path.startsWith("rooms.") && op.path.includes(".dressing"))).toBe(
      true,
    );

    const applied = apply(matched.model, dressed.patch, currentSince(matched.model));
    expect(applied.rejected).toEqual([]);
    expect(validateFlatModel(applied.model).success).toBe(true);
    const report = validate(applied.model);
    expect(report.modelId).toBe(original.id);
    expect(report.revision).toBe(applied.model.revision);

    for (const [roomId, expected] of Object.entries(LIVE_ROOM_FLOORS)) {
      const decision = dressed.diagnostics.rooms.find((row) => row.roomId === roomId);
      expect(decision, roomId).toMatchObject(expected);
      expect(applied.model.rooms[roomId]?.dressing?.level).toBe(1);
      expect(applied.model.rooms[roomId]?.dressing?.floor).toBe(expected.floor);
    }

    // Live Matcher swapped several rooms; L1 follows those bindings, not the visual rooms.
    expect(matched.model.assets.p4).toMatchObject({ room: "r3" });
    expect(matched.model.assets.p5).toMatchObject({ room: "r3" });
    expect(applied.model.rooms.r3?.dressing?.floor).toBe("parquet");
    expect(applied.model.rooms.r2?.dressing?.floor).toBe("parquet");
    expect(applied.model.rooms.r2?.dressing?.meta.floor?.basis).toBe("assumed");

    const repeat = runDresserL1({ model: applied.model });
    expect(repeat.patch.ops).toEqual([]);
    const repeatApply = apply(applied.model, repeat.patch, currentSince(applied.model));
    expect(repeatApply.model.revision).toBe(applied.model.revision);

    expect(await sha256File(modelPath)).toBe(beforeModel);
    expect(await sha256File(liveMatcherPath)).toBe(beforeLive);
    expect((await stat(modelPath)).isFile()).toBe(true);
    expect(clone.revision).toBe(original.revision);
    expect(clone.assets).toEqual(original.assets);
  });
});

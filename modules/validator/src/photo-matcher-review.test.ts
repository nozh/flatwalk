import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { apply } from "../../resolver/src/index.js";
import { createGrokClient } from "../../ai/src/grok.js";
import {
  PHOTO_MATCHER_54541_FIXTURE_ID,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  runPhotoMatcher,
} from "../../ai/src/photo-matcher.js";
import { describe, expect, it } from "vitest";
import { validate } from "./index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const modelPath = join(repoRoot, "fixtures/54541/flat.model.json");

describe("synthetic Matcher → Resolver → Validator (offline)", () => {
  it("puts low-confidence and question photo bindings into review without changing geometry", async () => {
    const model = JSON.parse(readFileSync(modelPath, "utf8"));
    const geometry = {
      vertices: structuredClone(model.vertices),
      walls: structuredClone(model.walls),
      openings: structuredClone(model.openings),
      rooms: structuredClone(model.rooms),
    };

    const result = await runPhotoMatcher({
      model,
      overlay: { imageBase64: "AA==" },
      grok: createGrokClient({
        mode: "fixture",
        transport: async () => {
          throw new Error("network must not be used for the synthetic Matcher fixture");
        },
      }),
      fixtureId: PHOTO_MATCHER_54541_FIXTURE_ID,
    });

    expect(result.diagnostics.synthetic).toBe(true);
    expect(result.diagnostics.liveApiCalled).toBe(false);
    expect(result.patch).not.toBeNull();

    const applied = apply(model, result.patch!, {
      schemaVersion: "0.1",
      modelId: model.id,
      baseRevision: model.revision,
      currentRevision: model.revision,
      changes: [],
    });
    expect(applied.rejected).toEqual([]);
    expect(applied.model.vertices).toEqual(geometry.vertices);
    expect(applied.model.walls).toEqual(geometry.walls);
    expect(applied.model.openings).toEqual(geometry.openings);
    expect(applied.model.rooms).toEqual(geometry.rooms);

    expect(applied.model.assets.p8?.meta.confidence).toBeLessThan(PHOTO_MATCHER_LOW_CONFIDENCE);
    expect(applied.model.assets.p12?.meta.confidence).toBeLessThan(PHOTO_MATCHER_LOW_CONFIDENCE);

    const report = validate(applied.model);
    const paths = report.review.items.map(item => item.path);
    expect(paths).toEqual(expect.arrayContaining(["assets.p8", "assets.p11", "assets.p12", "assets.p17"]));
    expect(report.walkReady).toBe(true);
    expect(report.checks.find(check => check.checkId === "navigation.clearance")?.status).toBe("skipped");
    expect(report.review.items.filter(item => item.path === "assets.p8")).toHaveLength(1);
  });
});

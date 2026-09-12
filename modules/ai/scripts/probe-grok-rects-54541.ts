/**
 * Isolated grok-rects vision probe for listing 54541.
 * Does not change Orchestrator/CLI. Uses createGrokClient + runGrokRects.
 *
 * Fixture (default):
 *   node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts
 *
 * Live (explicit, requires XAI_API_KEY):
 *   FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { adjacency, faces, roomPolygon } from "@flatwalk/geometry";
import { apply } from "@flatwalk/resolver";
import { validate } from "@flatwalk/validator";
import { AdapterError } from "../src/errors.ts";
import { createGrokClient, DEFAULT_GROK_MODEL } from "../src/grok.ts";
import { GROK_RECTS_PROMPT_VERSION, runGrokRects } from "../src/grok-rects.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const planPath = path.join(repoRoot, "fixtures/54541/plan.png");
const outDir = path.join(repoRoot, "../../docs/modules/plan-parser-54541");

function emptyRev0(id: string): FlatModel {
  const meta = { provenance: "importer@0.1", basis: "assumed" as const };
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
          wallHeight: { ...meta },
          doorHeight: { ...meta },
          windowSill: { ...meta },
          windowHeight: { ...meta },
        },
      },
    },
    plan: { asset: null, meta: { ...meta } },
    vertices: {},
    walls: {},
    openings: {},
    rooms: {},
    assets: {},
  };
}

function summarize(error: unknown): { code?: string; message: string } {
  if (error instanceof AdapterError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

const model = emptyRev0("cityexpert-54541-empty");
const planBytes = await readFile(planPath);
const grok = createGrokClient({
  mode: process.env.FLATWALK_ADAPTERS === "live" ? "live" : "fixture",
  env: process.env,
  transport:
    process.env.FLATWALK_ADAPTERS === "live"
      ? undefined
      : async () => {
          throw new Error("fixture mode does not call the network");
        },
});

const report: Record<string, unknown> = {
  listingId: "54541",
  planPath: "fixtures/54541/plan.png",
  planBytes: planBytes.length,
  adapterMode: grok.mode,
  promptVersion: GROK_RECTS_PROMPT_VERSION,
  defaultProviderModel: DEFAULT_GROK_MODEL,
  seededEtalonGeometry: false,
};

try {
  const result = await runGrokRects({
    model,
    plan: { imageBase64: planBytes.toString("base64") },
    grok,
  });
  report.liveApiCalled = result.diagnostics.liveApiCalled;
  report.synthetic = result.diagnostics.synthetic;
  report.httpStatus = result.diagnostics.httpStatus;
  report.imageAttached = result.diagnostics.imageAttached;
  report.providerModel = result.diagnostics.providerModel;
  report.geometrySuitable = result.diagnostics.geometrySuitable;
  report.reason = result.reason ?? null;
  report.patchPresent = result.patch != null;
  report.diagnosticsNote = result.diagnostics.note;
  if (result.diagnostics.synthetic === true) {
    report.recognition = "synthetic fixture, not a live 54541 vision result";
  }

  if (!result.patch) {
    report.pipeline = {
      resolver: "skipped",
      contract: "skipped",
      geometry: "skipped",
      validator: "skipped",
      geometryError: result.diagnostics.geometryError ?? null,
      schemaErrors: result.diagnostics.schemaErrors ?? [],
    };
  } else {
    const applied = apply(model, result.patch, {
      schemaVersion: "0.1",
      modelId: model.id,
      baseRevision: model.revision,
      currentRevision: model.revision,
      changes: [],
    });
    let geometry: unknown;
    try {
      const faceList = faces(applied.model);
      for (const id of Object.keys(applied.model.rooms).sort()) roomPolygon(applied.model, id);
      geometry = {
        ok: true,
        faces: faceList.length,
        adjacency: adjacency(applied.model).map((edge) => [...edge.rooms].sort().join("-")),
      };
    } catch (error) {
      geometry = { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
    const validation = validate(applied.model);
    report.pipeline = {
      resolverRejected: applied.rejected,
      nextRevision: applied.model.revision,
      contractSuccess: validateFlatModel(applied.model).success,
      geometry,
      validatorWalkReady: validation.walkReady,
      validatorCheckCount: validation.checks.length,
    };
  }

  if (result.diagnostics.liveApiCalled && result.patch) {
    report.fixtureWrite =
      "Live usable envelope would be saved here after stripping usage/ids; this run did not persist secrets.";
  }
} catch (error) {
  const summary = summarize(error);
  report.error = summary;
  if (summary.code === "missing-config") {
    report.missing = "XAI_API_KEY";
    report.liveApiCalled = false;
  }
}

const text = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(text);
const dest = path.join(
  outDir,
  grok.mode === "live" ? "grok-rects-54541.probe-live.json" : "grok-rects-54541.probe-fixture.json",
);
await writeFile(dest, text);
process.stderr.write(`wrote ${path.relative(repoRoot, dest)}\n`);
if (report.error && (report.error as { code?: string }).code === "missing-config") {
  process.exitCode = 2;
}

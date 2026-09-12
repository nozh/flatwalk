/**
 * Isolated Photo Matcher probe for listing 54541.
 * Uses the accepted manual geometry, Builder Node overlay, createGrokClient, runPhotoMatcher.
 * Does not change Orchestrator/CLI/Viewer. Does not rewrite fixtures/54541/flat.model.json.
 *
 * Fixture (default, not live evidence):
 *   node --import tsx modules/ai/scripts/probe-photo-matcher-54541.ts
 *
 * Live (explicit, one bounded attempt, requires XAI_API_KEY):
 *   FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-photo-matcher-54541.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateFlatModel, type FlatModel, type Patch } from "@flatwalk/contract";
import { renderOverlay } from "@flatwalk/builder/node";
import { apply } from "@flatwalk/resolver";
import { validate } from "@flatwalk/validator";
import { AdapterError } from "../src/errors.ts";
import { createGrokClient, DEFAULT_GROK_MODEL } from "../src/grok.ts";
import {
  PHOTO_MATCHER_54541_FIXTURE_ID,
  PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  PHOTO_MATCHER_PROMPT_VERSION,
  runPhotoMatcher,
} from "../src/photo-matcher.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const listingDir = path.join(repoRoot, "fixtures/54541");
const modelPath = path.join(listingDir, "flat.model.json");
const outDir = path.join(repoRoot, "../../docs/modules/photo-matcher-54541");

function loadDotEnv(filePath: string): boolean {
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function summarize(error: unknown): { code?: string; message: string } {
  if (error instanceof AdapterError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

function photoIds(model: FlatModel): string[] {
  return Object.entries(model.assets)
    .filter(([, asset]) => asset.kind === "photo")
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function geometryFingerprint(model: FlatModel) {
  return {
    vertexCount: Object.keys(model.vertices).length,
    wallCount: Object.keys(model.walls).length,
    roomCount: Object.keys(model.rooms).length,
    openingCount: Object.keys(model.openings).length,
    vertices: model.vertices,
    walls: model.walls,
    rooms: model.rooms,
  };
}

function setFromPatch(patch: Patch | null, assetId: string, field: string): unknown {
  const op = patch?.ops.find((item) => item.op === "set" && item.path === `assets.${assetId}.${field}`);
  return op && op.op === "set" ? op.value : undefined;
}

function classifyBindings(before: FlatModel, patch: Patch | null, after: FlatModel, dropped: Array<{ assetId?: string; reason: string }>) {
  const droppedBy = new Map<string, string[]>();
  for (const item of dropped) {
    if (!item.assetId) continue;
    const list = droppedBy.get(item.assetId) ?? [];
    list.push(item.reason);
    droppedBy.set(item.assetId, list);
  }
  return photoIds(before).map((id) => {
    const prev = before.assets[id];
    const next = after.assets[id];
    const proposedRoom = setFromPatch(patch, id, "room");
    const proposedFaces = setFromPatch(patch, id, "faces");
    const proposedLook = setFromPatch(patch, id, "look");
    const proposedMeta = setFromPatch(patch, id, "meta") as { confidence?: number; question?: string } | undefined;
    const inPatch = proposedRoom !== undefined;
    const droppedReasons = droppedBy.get(id) ?? [];
    let status: string;
    if (!inPatch && droppedReasons.includes("unknown-room")) status = "rejected-unknown-room";
    else if (!inPatch) status = "unmatched";
    else if (proposedRoom === null) status = "facade-unbound";
    else if (typeof proposedMeta?.confidence === "number" && proposedMeta.confidence < PHOTO_MATCHER_LOW_CONFIDENCE) {
      status = "uncertain-low-confidence";
    } else if (droppedReasons.includes("wall-not-on-room")) status = "applied-room-wall-dropped";
    else status = "applied";
    return {
      assetId: id,
      status,
      dropped: droppedReasons,
      before: {
        room: prev && "room" in prev ? prev.room : undefined,
        faces: prev && "faces" in prev ? prev.faces : undefined,
        provenance: prev?.meta.provenance,
        confidence: prev?.meta.confidence,
      },
      proposed: inPatch
        ? {
            room: proposedRoom,
            faces: proposedFaces,
            look: proposedLook,
            confidence: proposedMeta?.confidence,
            question: proposedMeta?.question,
          }
        : null,
      after: {
        room: next && "room" in next ? next.room : undefined,
        faces: next && "faces" in next ? next.faces : undefined,
        provenance: next?.meta.provenance,
        confidence: next?.meta.confidence,
        question: next?.meta.question,
      },
    };
  });
}

loadDotEnv(path.join(repoRoot, ".env"));

const modelBytes = await readFile(modelPath);
const modelHashBefore = sha256(modelBytes);
const model = JSON.parse(modelBytes.toString("utf8")) as FlatModel;
const planPng = await readFile(path.join(listingDir, "plan.png"));
const overlay = await renderOverlay(model, planPng);
const photos = await Promise.all(
  photoIds(model).map(async (id) => {
    const asset = model.assets[id];
    const relative = asset?.url ?? `photos/photo-${id.slice(1).padStart(2, "0")}.jpg`;
    const bytes = await readFile(path.join(listingDir, relative));
    return {
      assetId: id,
      bytes: bytes.length,
      imageUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    };
  }),
);

const live = process.env.FLATWALK_ADAPTERS === "live";
const grok = createGrokClient({
  mode: live ? "live" : "fixture",
  env: process.env,
  transport: live
    ? undefined
    : async () => {
        throw new Error("fixture mode does not call the network");
      },
});

const started = Date.now();
const report: Record<string, unknown> = {
  listingId: "54541",
  geometrySource: "accepted manual fixture fixtures/54541/flat.model.json; not automatic recognition",
  modelId: model.id,
  revision: model.revision,
  modelSha256Before: modelHashBefore,
  photoCount: photos.length,
  photoBytes: photos.map((photo) => ({ assetId: photo.assetId, bytes: photo.bytes })),
  overlay: {
    import: "@flatwalk/builder/node",
    kind: overlay.meta.kind,
    modelId: overlay.meta.modelId,
    revision: overlay.meta.revision,
    width: overlay.meta.width,
    height: overlay.meta.height,
    pxPerMeter: overlay.meta.pxPerMeter,
    diagnostics: overlay.meta.diagnostics,
    pngBytes: overlay.png.byteLength,
    schemePngPresent: overlay.schemePng != null,
  },
  adapterMode: grok.mode,
  promptVersion: PHOTO_MATCHER_PROMPT_VERSION,
  defaultProviderModel: DEFAULT_GROK_MODEL,
  timeoutMs: PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  fixtureId: live ? null : PHOTO_MATCHER_54541_FIXTURE_ID,
  photosAttached: photos.length,
  overlayAttached: true,
};

try {
  const result = await runPhotoMatcher({
    model,
    overlay: { imageUrl: `data:image/png;base64,${Buffer.from(overlay.png).toString("base64")}` },
    photos: photos.map(({ assetId, imageUrl }) => ({ assetId, imageUrl })),
    grok,
    fixtureId: PHOTO_MATCHER_54541_FIXTURE_ID,
    timeoutMs: PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  });
  report.durationMs = Date.now() - started;
  report.liveApiCalled = result.diagnostics.liveApiCalled;
  report.synthetic = result.diagnostics.synthetic;
  report.diagnosticsNote = result.diagnostics.note;
  report.schemaErrors = result.diagnostics.schemaErrors ?? [];
  report.dropped = result.diagnostics.dropped;
  report.reason = result.reason ?? null;
  report.patchPresent = result.patch != null;
  report.patchModelId = result.patch?.modelId ?? null;
  report.patchBaseRevision = result.patch?.baseRevision ?? null;
  report.patchModule = result.patch?.module ?? null;
  if (result.diagnostics.synthetic === true) {
    report.recognition = "synthetic fixture, not a live 54541 vision result";
  } else if (result.diagnostics.liveApiCalled) {
    report.recognition = "live matcher attempt; still applied onto manual geometry, not proof of automatic recognition";
  }

  if (!result.patch) {
    report.pipeline = {
      resolver: "skipped",
      contract: "skipped",
      validator: "skipped",
    };
  } else {
    const applied = apply(model, result.patch, {
      schemaVersion: "0.1",
      modelId: model.id,
      baseRevision: model.revision,
      currentRevision: model.revision,
      changes: [],
    });
    const beforeGeo = geometryFingerprint(model);
    const afterGeo = geometryFingerprint(applied.model);
    const validation = validate(applied.model);
    const lowConfidenceAssets = photoIds(applied.model).filter((id) => {
      const confidence = applied.model.assets[id]?.meta.confidence;
      return typeof confidence === "number" && confidence < PHOTO_MATCHER_LOW_CONFIDENCE;
    });
    report.pipeline = {
      resolverRejected: applied.rejected,
      nextRevision: applied.model.revision,
      contractSuccess: validateFlatModel(applied.model).success,
      geometryUnchanged:
        JSON.stringify(beforeGeo.vertices) === JSON.stringify(afterGeo.vertices) &&
        JSON.stringify(beforeGeo.walls) === JSON.stringify(afterGeo.walls) &&
        JSON.stringify(beforeGeo.rooms) === JSON.stringify(afterGeo.rooms),
      validatorWalkReady: validation.walkReady,
      validatorModelId: validation.modelId,
      validatorRevision: validation.revision,
      validatorReviewItems: validation.review.items,
      validatorReviewPaths: validation.review.items.map((item) => item.path),
      lowConfidenceAssets,
      lowConfidenceInValidatorReview: lowConfidenceAssets.filter((id) =>
        validation.review.items.some((item) => item.path === `assets.${id}` || item.path.startsWith(`assets.${id}.`)),
      ),
      validatorGap:
        "Validator review.items currently lists unmarked exterior doors, not Matcher low-confidence / meta.question photo bindings.",
    };
    report.bindings = classifyBindings(model, result.patch, applied.model, result.diagnostics.dropped);
  }

  if (result.diagnostics.liveApiCalled && result.diagnostics.raw) {
    report.rawChars = result.diagnostics.raw.length;
    report.fixtureWrite =
      "Live usable envelope would be saved here after stripping usage/ids; this run did not persist secrets.";
  }
} catch (error) {
  const summary = summarize(error);
  report.durationMs = Date.now() - started;
  report.error = summary;
  report.pipeline = {
    resolver: "skipped",
    contract: "skipped",
    validator: "skipped",
  };
  if (summary.code === "missing-config") {
    report.missing = "XAI_API_KEY";
    report.liveApiCalled = false;
    report.liveAttempted = false;
  } else if (summary.code === "timeout" || summary.code === "api-error") {
    report.liveApiCalled = false;
    report.liveAttempted = true;
    report.photosAttached = photos.length;
    report.overlayAttached = true;
    report.adapterOwner =
      "shared createGrokClient; coordinate with Parser owner, do not change the adapter in this task";
  }
}

const modelHashAfter = sha256(await readFile(modelPath));
report.modelSha256After = modelHashAfter;
report.acceptedReferenceUnchanged = modelHashBefore === modelHashAfter;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, `overlay-rev-${String(model.revision).padStart(3, "0")}.png`), overlay.png);
await writeFile(
  path.join(outDir, `overlay-rev-${String(model.revision).padStart(3, "0")}.meta.json`),
  `${JSON.stringify(overlay.meta, null, 2)}\n`,
);

const text = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(text);
const dest = path.join(
  outDir,
  grok.mode === "live" ? "photo-matcher-54541.probe-live.json" : "photo-matcher-54541.probe-fixture.json",
);
await writeFile(dest, text);
process.stderr.write(`wrote ${path.relative(repoRoot, dest)}\n`);
if (report.error && (report.error as { code?: string }).code === "missing-config") {
  process.exitCode = 2;
}

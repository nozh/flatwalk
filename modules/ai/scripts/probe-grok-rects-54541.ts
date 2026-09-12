/**
 * Isolated grok-rects vision probe for listing 54541.
 * Does not change Orchestrator/CLI. Uses createGrokClient + runGrokRects.
 *
 * Fixture (default):
 *   node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts
 *
 * Live diagnosis (GET models + one tiny vision completion; not 54541 recognition):
 *   FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts --diagnose
 *
 * Live original plan:
 *   FLATWALK_ADAPTERS=live node --import tsx modules/ai/scripts/probe-grok-rects-54541.ts
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderOverlay } from "@flatwalk/builder/node";
import { validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { adjacency, faces, roomPolygon } from "@flatwalk/geometry";
import { apply } from "@flatwalk/resolver";
import { validate } from "@flatwalk/validator";
import { AdapterError } from "../src/errors.ts";
import { loadEnvFiles, redactSecrets } from "../src/env.ts";
import {
  createGrokClient,
  DEFAULT_GROK_MODEL,
  XAI_LANGUAGE_MODELS_URL,
  type GrokLanguageModel,
} from "../src/grok.ts";
import {
  GROK_RECTS_CHAT_EXTRA,
  GROK_RECTS_PROMPT_VERSION,
  GROK_RECTS_TIMEOUT_MS,
  runGrokRects,
} from "../src/grok-rects.ts";
import { fetchTransport } from "../src/transport.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const planPath = path.join(repoRoot, "fixtures/54541/plan.png");
const outDir = path.join(repoRoot, "../../docs/modules/plan-parser-54541");
const diagnose = process.argv.includes("--diagnose");

const envLoad = await loadEnvFiles(
  [path.join(repoRoot, ".env"), path.join(repoRoot, "modules/ai/.env")],
  process.env,
);

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

function summarize(error: unknown): { code?: string; message: string; status?: number; details?: string } {
  if (error instanceof AdapterError) {
    return { code: error.code, message: error.message, status: error.status, details: error.details };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

function envPresence() {
  return {
    filesReadCount: envLoad.filesRead.length,
    keysAssigned: envLoad.keysAssigned,
    xaiApiKey: process.env.XAI_API_KEY ? "present" : "missing",
    xaiModelOverride: process.env.XAI_MODEL ? "present" : "unset-using-default",
    adapters: process.env.FLATWALK_ADAPTERS ?? "(unset)",
  };
}

function visionModels(models: GrokLanguageModel[]): GrokLanguageModel[] {
  return models.filter((model) => {
    if (!model.input_modalities) return true;
    return model.input_modalities.some((item) => item.toLowerCase() === "image");
  });
}

function pickVisionModel(models: GrokLanguageModel[], configured: string): {
  selected: string;
  reason: string;
  listed: boolean;
  imageModality: boolean | "unspecified";
} {
  const vision = visionModels(models);
  const exact = vision.find((model) => model.id === configured || model.aliases?.includes(configured));
  if (exact) {
    const image =
      exact.input_modalities == null
        ? "unspecified"
        : exact.input_modalities.some((item) => item.toLowerCase() === "image");
    return {
      selected: exact.id,
      reason: "configured id is present on GET /v1/language-models",
      listed: true,
      imageModality: image,
    };
  }
  const withImage = vision.find((model) =>
    (model.input_modalities ?? []).some((item) => item.toLowerCase() === "image"),
  );
  if (withImage) {
    return {
      selected: withImage.id,
      reason: `configured ${configured} not listed; using first language-model with image modality`,
      listed: false,
      imageModality: true,
    };
  }
  return {
    selected: configured,
    reason: "no image-capable model advertised; keeping configured id (availability unproven)",
    listed: false,
    imageModality: "unspecified",
  };
}

function schematicSvg(
  rooms: Array<{ id: string; type: string; polygon: number[][] | null }>,
  openingCount: number,
): string {
  const points = rooms.flatMap((room) => room.polygon ?? []);
  const xs = points.map((point) => point[0]!);
  const ys = points.map((point) => point[1]!);
  const minX = Math.min(0, ...xs) - 1;
  const minY = Math.min(0, ...ys) - 1;
  const maxX = Math.max(8, ...xs) + 1;
  const maxY = Math.max(8, ...ys) + 1;
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = 40;
  const pad = 24;
  const svgW = width * scale + pad * 2;
  const svgH = height * scale + pad * 2;
  const tx = (x: number) => pad + (x - minX) * scale;
  const ty = (y: number) => svgH - (pad + (y - minY) * scale);
  const colors: Record<string, string> = {
    living: "#7aa2f7",
    kitchen: "#e0af68",
    bedroom: "#9ece6a",
    bathroom: "#7dcfff",
    wc: "#bb9af7",
    hall: "#c0caf5",
    corridor: "#a9b1d6",
    storage: "#565f89",
    unknown: "#f7768e",
  };
  const polygons = rooms
    .map((room) => {
      if (!room.polygon || room.polygon.length < 3) return "";
      const d = room.polygon.map((p) => `${tx(p[0]!)},${ty(p[1]!)}`).join(" ");
      const fill = colors[room.type] ?? "#f7768e";
      const cx = tx(room.polygon.reduce((s, p) => s + p[0]!, 0) / room.polygon.length);
      const cy = ty(room.polygon.reduce((s, p) => s + p[1]!, 0) / room.polygon.length);
      return `<polygon points="${d}" fill="${fill}" fill-opacity="0.45" stroke="#1a1b26" stroke-width="2"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#1a1b26">${room.id} ${room.type}</text>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW.toFixed(0)}" height="${svgH.toFixed(0)}" viewBox="0 0 ${svgW.toFixed(0)} ${svgH.toFixed(0)}">
  <rect width="100%" height="100%" fill="#f4f4f5"/>
  ${polygons}
  <text x="${pad}" y="${svgH - 8}" font-size="11" font-family="sans-serif" fill="#414868">54541 grok-rects schematic, ${rooms.length} rooms, ${openingCount} openings; meters assumed, not pixels of plan.png</text>
</svg>
`;
}

/** x.ai rejects images smaller than 8×8 (`invalid_image`). 1×1 diagnostic 400 is not a plan timeout. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC",
  "base64",
);

async function runDiagnose(): Promise<Record<string, unknown>> {
  const started = Date.now();
  const report: Record<string, unknown> = {
    kind: "diagnose",
    listingId: "54541",
    recognition: "not attempted; this run is connectivity/auth/model/tiny-image only",
    env: envPresence(),
    docs: {
      languageModels: "https://docs.x.ai/docs/api-reference#list-language-models",
      imageUnderstanding: "https://docs.x.ai/docs/guides/image-understanding",
      reasoningEffort: "https://docs.x.ai/docs/guides/reasoning",
      note: "grok-4.6 reasoning_effort defaults to high and cannot be disabled; official vision samples use a 3600s client timeout. Probe uses reasoning_effort=low and a 180s grok-rects cap.",
    },
    billableGenerationsThisRun: 0,
  };

  const unauthStarted = Date.now();
  try {
    const unauth = await fetchTransport({
      url: XAI_LANGUAGE_MODELS_URL,
      method: "GET",
      headers: { accept: "application/json" },
    });
    report.connectivity = {
      ok: unauth.status === 401 || unauth.status === 403 || (unauth.status >= 200 && unauth.status < 300),
      httpStatus: unauth.status,
      latencyMs: Date.now() - unauthStarted,
      interpretation:
        unauth.status === 401 || unauth.status === 403
          ? "api.x.ai reachable; unauthenticated GET rejected as expected"
          : `unexpected status ${unauth.status}`,
    };
  } catch (error) {
    report.connectivity = {
      ok: false,
      latencyMs: Date.now() - unauthStarted,
      error: summarize(error),
    };
    report.elapsedMs = Date.now() - started;
    return report;
  }

  const grok = createGrokClient({
    mode: "live",
    env: process.env,
  });
  const configured = process.env.XAI_MODEL ?? DEFAULT_GROK_MODEL;
  const authStarted = Date.now();
  try {
    const listed = await grok.listLanguageModels();
    const pick = pickVisionModel(listed.models, configured);
    report.authentication = { ok: listed.status === 200, httpStatus: listed.status, latencyMs: Date.now() - authStarted };
    report.models = {
      endpoint: XAI_LANGUAGE_MODELS_URL,
      count: listed.models.length,
      ids: listed.models.map((model) => model.id).slice(0, 40),
      configured,
      pick,
    };
    const tinyStarted = Date.now();
    try {
      const tiny = await grok.chatCompletions({
        fixtureId: "unused",
        model: pick.selected,
        timeoutMs: 90_000,
        extra: { ...GROK_RECTS_CHAT_EXTRA },
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${TINY_PNG.toString("base64")}`, detail: "low" } },
              { type: "text", text: 'Reply with JSON {"ok":true,"color":"<dominant>"} only.' },
            ],
          },
        ],
      });
      report.billableGenerationsThisRun = 1;
      const content = tiny.body.choices[0]?.message.content ?? null;
      report.tinyVision = {
        ok: typeof content === "string" && content.length > 0,
        latencyMs: Date.now() - tinyStarted,
        providerModel: tiny.body.model ?? pick.selected,
        finishReason: tiny.body.choices[0]?.finish_reason ?? null,
        contentChars: typeof content === "string" ? content.length : 0,
        contentPreview: typeof content === "string" ? content.slice(0, 200) : null,
        usage: tiny.body.usage ?? null,
        request: {
          model: pick.selected,
          timeoutMs: 90_000,
          extra: GROK_RECTS_CHAT_EXTRA,
          imageBytes: TINY_PNG.length,
          detail: "low",
        },
      };
    } catch (error) {
      report.billableGenerationsThisRun = 1;
      report.tinyVision = {
        ok: false,
        latencyMs: Date.now() - tinyStarted,
        error: summarize(error),
        request: { model: pick.selected, timeoutMs: 90_000, extra: GROK_RECTS_CHAT_EXTRA },
      };
    }
  } catch (error) {
    report.authentication = { ok: false, latencyMs: Date.now() - authStarted, error: summarize(error) };
  }

  report.elapsedMs = Date.now() - started;
  return report;
}

const adapterMode = process.env.FLATWALK_ADAPTERS === "live" ? "live" : "fixture";
const grok = createGrokClient({
  mode: adapterMode,
  env: process.env,
  transport:
    adapterMode === "live"
      ? undefined
      : async () => {
          throw new Error("fixture mode does not call the network");
        },
});

if (diagnose) {
  if (adapterMode !== "live") {
    const refused = {
      kind: "diagnose",
      error: { code: "invalid-mode", message: "Pass FLATWALK_ADAPTERS=live with --diagnose; fixture mode does not call x.ai" },
      liveApiCalled: false,
    };
    const text = `${JSON.stringify(refused, null, 2)}\n`;
    process.stdout.write(text);
    process.exitCode = 2;
  } else {
  const report = redactSecrets(await runDiagnose()) as Record<string, unknown>;
  const text = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(text);
  const dest = path.join(outDir, "grok-rects-54541.probe-diagnose.json");
  await writeFile(dest, text);
  process.stderr.write(`wrote ${path.relative(repoRoot, dest)}\n`);
  if (report.tinyVision && typeof report.tinyVision === "object" && (report.tinyVision as { ok?: boolean }).ok !== true) {
    process.exitCode = 3;
  }
  }
} else {
  const model = emptyRev0("cityexpert-54541-empty");
  const planBytes = await readFile(planPath);
  const planSha256 = createHash("sha256").update(planBytes).digest("hex");
  const started = Date.now();
  const report: Record<string, unknown> = {
    listingId: "54541",
    planPath: "fixtures/54541/plan.png",
    planBytes: planBytes.length,
    planSha256,
    adapterMode: grok.mode,
    promptVersion: GROK_RECTS_PROMPT_VERSION,
    defaultProviderModel: DEFAULT_GROK_MODEL,
    requestConfig: {
      model: process.env.XAI_MODEL ?? DEFAULT_GROK_MODEL,
      timeoutMs: GROK_RECTS_TIMEOUT_MS,
      extra: GROK_RECTS_CHAT_EXTRA,
      image: "data:image/png;base64 (fixtures/54541/plan.png)",
      detail: "high",
    },
    seededEtalonGeometry: false,
    env: envPresence(),
  };

  try {
    const result = await runGrokRects({
      model,
      plan: { imageBase64: planBytes.toString("base64") },
      grok,
    });
    report.latencyMs = Date.now() - started;
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
    } else if (result.diagnostics.liveApiCalled) {
      report.recognition = result.patch
        ? "live x.ai completion on fixtures/54541/plan.png; fixture not substituted"
        : "live x.ai completion on fixtures/54541/plan.png received but geometry refused; fixture not substituted";
    }

    report.droppedDoors = result.diagnostics.droppedDoors ?? [];
    report.intersectingRooms = result.diagnostics.intersectingRooms ?? [];
    report.schemaErrors = result.diagnostics.schemaErrors ?? [];
    report.geometryError = result.diagnostics.geometryError ?? null;

    if (result.patch) {
      const sanitizedPatch = {
        schemaVersion: result.patch.schemaVersion,
        modelId: result.patch.modelId,
        baseRevision: result.patch.baseRevision,
        module: result.patch.module,
        opCount: result.patch.ops.length,
      };
      report.patchEnvelope = sanitizedPatch;
      await writeFile(
        path.join(outDir, grok.mode === "live" ? "grok-rects-54541.live.patch.json" : "grok-rects-54541.fixture.patch.json"),
        `${JSON.stringify(result.patch, null, 2)}\n`,
      );
    }

    if (!result.patch) {
      report.pipeline = {
        resolver: "skipped",
        contract: "skipped",
        geometry: "skipped",
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
      const rooms = Object.entries(applied.model.rooms)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, room]) => {
          let polygon: number[][] | null = null;
          try {
            polygon = roomPolygon(applied.model, id).map((point) => [point[0], point[1]]);
          } catch {
            polygon = null;
          }
          return { id, type: room.type, label: room.label ?? null, anchor: room.anchor, polygon };
        });
      const openings = Object.entries(applied.model.openings)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, opening]) => ({
          id,
          kind: opening.kind,
          wall: opening.wall,
          passable: "passable" in opening ? (opening.passable ?? null) : null,
          width: opening.width,
        }));
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
      report.rooms = rooms.map((room) => ({
        id: room.id,
        type: room.type,
        label: room.label,
        anchor: room.anchor,
      }));
      report.openings = openings;
      report.vertexCount = Object.keys(applied.model.vertices).length;
      report.wallCount = Object.keys(applied.model.walls).length;
      report.pipeline = {
        resolverRejected: applied.rejected,
        nextRevision: applied.model.revision,
        contractSuccess: validateFlatModel(applied.model).success,
        geometry,
        validatorWalkReady: validation.walkReady,
        validatorCheckCount: validation.checks.length,
        validatorFailed: validation.checks
          .filter((item) => item.status !== "pass" && item.status !== "unverified")
          .map((item) => item.checkId),
      };
      const schematicName =
        grok.mode === "live"
          ? "grok-rects-54541.probe-live.schematic.svg"
          : "grok-rects-54541.probe-fixture.schematic.svg";
      await writeFile(path.join(outDir, schematicName), schematicSvg(rooms, openings.length));
      report.schematic = `docs/modules/plan-parser-54541/${schematicName}`;
      try {
        const overlay = await renderOverlay(applied.model, planBytes);
        const overlayName =
          grok.mode === "live" ? "grok-rects-54541.probe-live.overlay.png" : "grok-rects-54541.probe-fixture.overlay.png";
        await writeFile(path.join(outDir, overlayName), Buffer.from(overlay.png));
        if (overlay.schemePng) {
          const schemeName =
            grok.mode === "live"
              ? "grok-rects-54541.probe-live.overlay-scheme.png"
              : "grok-rects-54541.probe-fixture.overlay-scheme.png";
          await writeFile(path.join(outDir, schemeName), Buffer.from(overlay.schemePng));
          report.overlayScheme = `docs/modules/plan-parser-54541/${schemeName}`;
        }
        report.overlay = {
          file: `docs/modules/plan-parser-54541/${overlayName}`,
          kind: overlay.meta.kind,
          pxPerMeter: overlay.meta.pxPerMeter ?? null,
          diagnostics: overlay.meta.diagnostics,
          ids: overlay.meta.ids,
          note:
            overlay.meta.kind === "aligned"
              ? "Walls registered onto plan.png pixels"
              : "Assumed-meter schematic; not a pixel registration of plan.png. Resemblance must be judged separately from schema/graph validity.",
        };
      } catch (error) {
        report.overlay = { error: error instanceof Error ? error.message : String(error) };
      }
      report.axes = {
        apiSuccess: Boolean(result.diagnostics.liveApiCalled || result.diagnostics.synthetic),
        schemaAndGraph: Boolean(
          result.diagnostics.geometrySuitable &&
            (report.pipeline as { contractSuccess?: boolean }).contractSuccess &&
            (report.pipeline as { geometry?: { ok?: boolean } }).geometry &&
            typeof (report.pipeline as { geometry?: { ok?: boolean } }).geometry === "object",
        ),
        resemblanceToPlan:
          "manual; overlay kind scheme cannot prove apartment 54541 (9 rooms: living, dining, kitchen, 3 bedrooms, 2 baths, hall)",
      };
    }
  } catch (error) {
    const summary = summarize(error);
    report.latencyMs = Date.now() - started;
    report.error = summary;
    report.pipeline = {
      resolver: "skipped",
      contract: "skipped",
      geometry: "skipped",
      validator: "skipped",
    };
    if (summary.code === "missing-config") {
      report.missing = "XAI_API_KEY";
      report.liveApiCalled = false;
      report.liveAttempted = false;
    } else if (summary.code === "timeout" || summary.code === "api-error") {
      report.liveApiCalled = false;
      report.liveAttempted = true;
      report.imageAttached = true;
    }
  }

  const text = `${JSON.stringify(redactSecrets(report), null, 2)}\n`;
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
}

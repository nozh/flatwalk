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

  report.droppedDoors = result.diagnostics.droppedDoors ?? [];
  report.intersectingRooms = result.diagnostics.intersectingRooms ?? [];
  report.schemaErrors = result.diagnostics.schemaErrors ?? [];
  report.geometryError = result.diagnostics.geometryError ?? null;

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
    report.rooms = rooms;
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
  }

  if (result.diagnostics.liveApiCalled && result.patch) {
    report.fixtureWrite =
      "Live usable envelope would be saved here after stripping usage/ids; this run did not persist secrets.";
  }
} catch (error) {
  const summary = summarize(error);
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

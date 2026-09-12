import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AdapterError, createGrokClient } from "@flatwalk/ai";
import { GROK_RECTS_FALLBACK_WHEN, GROK_RECTS_FIXTURE_ID, runGrokRects } from "@flatwalk/ai/grok-rects";
import { PatchSchema, type Patch } from "@flatwalk/contract";
import type { ListingBundle } from "@flatwalk/firecrawl";
import { apply } from "@flatwalk/resolver";
import type { AdapterMode } from "./adapters.ts";
import { CliError, EXIT } from "./errors.ts";
import { appendHistory, contextForPatch, loadHistory, publishRevision } from "./history.ts";
import { requireRunDir } from "./layout.ts";
import { loadLatestModel, readJsonFile } from "./model-io.ts";
import { repoRoot, runPaths } from "./paths.ts";
import { resolveExistingPath } from "./resolve-path.ts";
import { writeAcceptedOverlay } from "./overlay.ts";
import { parserOutcomeLabel, parserTimeoutMs, runHttpParser, runPythonParser } from "./python-parser.ts";
import { bindPatchToModel } from "./saved-patch.ts";

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

function patchSlug(module: string): string {
  return module.replace(/@[\d.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

async function nextPatchFile(patchesDir: string, module: string): Promise<string> {
  const names = await readdir(patchesDir).catch(() => [] as string[]);
  let max = 0;
  for (const name of names) {
    const match = /^(\d{3})-/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return path.join(patchesDir, `${pad(max + 1)}-${patchSlug(module)}.json`);
}

async function listingInputs(runRoot: string): Promise<{
  listingId: string;
  area?: number;
  planPath: string;
  planUrl?: string;
}> {
  const paths = runPaths(runRoot);
  const listing = (await readJsonFile(paths.listing)) as ListingBundle;
  const listingId = listing.source?.listingId;
  if (!listingId) throw new CliError(EXIT.io, `listing.json has no source.listingId: ${paths.listing}`);
  const planAsset = Object.values(listing.assets ?? {}).find((asset) => asset.kind === "plan");
  const candidates = [
    planAsset ? path.resolve(runRoot, planAsset.localPath) : undefined,
    path.join(paths.materials, "plan.png"),
  ];
  let planPath: string | undefined;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = await resolveExistingPath(candidate);
    if (resolved) {
      planPath = resolved;
      break;
    }
  }
  if (!planPath) {
    throw new CliError(EXIT.io, `Plan image not found in ${paths.materials}. Fixture mode will not fetch it.`);
  }
  const area = typeof listing.areaSqm === "number" && listing.areaSqm > 0 ? listing.areaSqm : undefined;
  return { listingId, area, planPath, planUrl: planAsset?.sourceUrl };
}

async function writeDiagnostics(parserDir: string, diagnostics: unknown): Promise<void> {
  await writeFile(path.join(parserDir, "diagnostics.json"), `${JSON.stringify(diagnostics, null, 2)}\n`);
}

function asPatch(value: unknown, origin: string): Patch {
  const parsed = PatchSchema.safeParse(value);
  if (!parsed.success) {
    throw new CliError(EXIT.model, `Parser ${origin} returned a value that is not a Contract Patch`);
  }
  return parsed.data;
}

export type ParseOptions = {
  env?: NodeJS.Dict<string>;
  parser?: "python" | "http";
};

export async function runParse(runDir: string, adapters: AdapterMode, options: ParseOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const paths = await requireRunDir(runDir);
  const model = await loadLatestModel(paths.root);
  const previous = structuredClone(model);
  const history = await loadHistory(paths.root, model);
  const listing = await listingInputs(paths.root);
  const diagnostics: Record<string, unknown> = {
    modelId: model.id,
    baseRevision: model.revision,
    repairLoop: "later-runGeometryRepair",
    grokRectsFallbackWhen: [...GROK_RECTS_FALLBACK_WHEN],
  };

  const timeoutMs = parserTimeoutMs(env);
  const parserUrl = (env.PARSER_URL ?? "").trim();
  const parserMode = options.parser ?? (parserUrl ? "http" : "python");
  console.log(
    parserMode === "http"
      ? `parse: PARSER_URL HTTP plan-parser (timeout ${timeoutMs} ms)`
      : `parse: calling python -m plan_parser (timeout ${timeoutMs} ms)`,
  );
  const python =
    parserMode === "http"
      ? await runHttpParser({
          planPath: listing.planPath,
          listingId: listing.listingId,
          area: listing.area,
          outDir: paths.parser,
          env,
        })
      : await runPythonParser({
          planPath: listing.planPath,
          listingId: listing.listingId,
          area: listing.area,
          outDir: paths.parser,
          repoRoot: repoRoot(),
          env,
        });
  diagnostics.python = {
    transport: parserMode,
    outcome: parserOutcomeLabel(python),
    timeout: python.timeout,
    unavailable: python.unavailable === true,
    error: python.error,
    exitCode: python.exitCode,
    reason: python.result?.reason,
    patchPresent: python.result?.patch != null,
  };

  let patch: Patch | null = null;
  let source: "plan-parser" | "grok-rects" | undefined;
  let fallbackReason: string | undefined;

  if (python.timeout) {
    fallbackReason = python.error ?? `plan-parser timeout after ${timeoutMs} ms`;
  } else if (python.error) {
    fallbackReason = python.error;
  } else if (python.result?.patch == null) {
    fallbackReason = python.result?.reason ?? "OpenCV / plan-parser returned patch: null";
  } else {
    patch = asPatch(python.result.patch, "python");
    source = "plan-parser";
  }

  if (!patch) {
    const savedPath = (env.FLATWALK_SAVED_PARSER_PATCH ?? "").trim();
    if (savedPath) {
      console.log(`parse: Python empty/error/timeout → saved grok-rects patch (${fallbackReason})`);
      diagnostics.fallback = fallbackReason;
      const resolved = await resolveExistingPath(savedPath);
      if (!resolved) {
        diagnostics.keptRevision = model.revision;
        await writeDiagnostics(paths.parser, diagnostics);
        throw new CliError(EXIT.io, `Saved parser patch not found: ${savedPath}`);
      }
      const raw = JSON.parse(await readFile(resolved, "utf8")) as unknown;
      const bound = bindPatchToModel(asPatch(raw, "saved-parser-patch"), model);
      patch = bound.patch;
      source = "grok-rects";
      diagnostics.savedPatch = {
        file: resolved,
        sourceModelId: bound.remappedFrom,
        modelId: patch.modelId,
        baseRevision: patch.baseRevision,
        liveApiCalled: false,
        synthetic: false,
      };
      console.log(
        `parse: saved grok-rects patch ${bound.remappedFrom} → ${model.id} rev ${model.revision}; no vision call`,
      );
    }
  }

  if (!patch) {
    console.log(`parse: Python empty/error/timeout → grok-rects (${fallbackReason})`);
    diagnostics.fallback = fallbackReason;
    try {
      const grok = createGrokClient({
        mode: adapters,
        env,
        fixtureDir: env.FLATWALK_GROK_FIXTURE_DIR,
        transport:
          adapters === "fixture"
            ? async () => {
                throw new Error("fixture mode does not call the network");
              }
            : undefined,
      });
      const grokResult = await runGrokRects({
        model,
        plan: { imageUrl: listing.planUrl ?? listing.planPath },
        grok,
        fixtureId: env.FLATWALK_GROK_FIXTURE_ID ?? GROK_RECTS_FIXTURE_ID,
      });
      diagnostics.grokRects = {
        reason: grokResult.reason,
        synthetic: grokResult.diagnostics.synthetic,
        liveApiCalled: grokResult.diagnostics.liveApiCalled,
        note: grokResult.diagnostics.note,
      };
      if (grokResult.diagnostics.synthetic === true) {
        console.log("parse: synthetic grok-rects fixture, not recognition of a real plan");
      }
      if (grokResult.diagnostics.liveApiCalled) {
        console.log("parse: live grok-rects API was called");
      }
      if (grokResult.patch) {
        patch = grokResult.patch;
        source = "grok-rects";
      } else {
        diagnostics.keptRevision = model.revision;
        await writeDiagnostics(paths.parser, diagnostics);
        throw new CliError(
          EXIT.model,
          `parse refused: grok-rects returned no patch (${grokResult.reason ?? "unknown"}). Previous model kept.`,
        );
      }
    } catch (error) {
      diagnostics.keptRevision = model.revision;
      await writeDiagnostics(paths.parser, diagnostics);
      const code = error instanceof AdapterError ? error.code : (error as { code?: string }).code;
      if (code === "missing-fixture" || code === "missing-config") {
        throw new CliError(
          EXIT.adapters,
          error instanceof Error ? error.message : "Fixture file is missing. Fixture mode does not call the network.",
        );
      }
      if (error instanceof CliError) throw error;
      throw error;
    }
  }

  if (!patch) {
    throw new CliError(EXIT.model, "parse refused: no patch. Previous model kept.");
  }

  const context = contextForPatch(history, model, patch);
  const applied = apply(model, patch, context);
  diagnostics.resolver = {
    source,
    applied: applied.applied.length,
    rejected: applied.rejected,
    nextRevision: applied.model.revision,
  };
  diagnostics.repairLoop = "later-runGeometryRepair";

  if (applied.rejected.length > 0 || applied.model.revision === model.revision) {
    diagnostics.keptRevision = model.revision;
    await writeDiagnostics(paths.parser, diagnostics);
    throw new CliError(
      EXIT.model,
      "parse refused: Resolver did not accept the patch. Previous model kept; no new revision published.",
      applied.rejected.map((item) => `${item.path}: ${item.reason}`),
    );
  }

  const nextHistory = appendHistory(history, model, applied);
  const patchFile = await nextPatchFile(paths.patches, patch.module);
  await publishRevision({
    runDir: paths.root,
    previous,
    previousHistory: history,
    next: applied.model,
    patch,
    history: nextHistory,
    patchFile,
  });
  diagnostics.publishedRevision = applied.model.revision;
  diagnostics.patchFile = patchFile;
  await writeDiagnostics(paths.parser, diagnostics);
  try {
    await writeAcceptedOverlay(paths.root, applied.model, listing.planPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`parse: overlay failed (${message}); published revision kept`);
  }
  console.log(`parse: ${source} patch → ${patchFile}`);
  console.log(`parse: accepted ${applied.model.id} rev ${applied.model.revision} via public Resolver`);
  console.log("parse: proposeRepair is not called; repair is a later runGeometryRepair stage");
}

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AdapterMode } from "./adapters.ts";
import { CliError } from "./errors.ts";
import { runBuild } from "./build.ts";
import { runImport } from "./import.ts";
import {
  appendRun,
  ingestJobArtifacts,
  readJobRecord,
  writeJobRecord,
  type JobRecord,
  type JobStage,
  type JobView,
  type RunRecord,
  type StageOutcome,
} from "./job-store.ts";
import { runParse } from "./parse.ts";
import { printPipelineOutcome } from "./outcome.ts";
import { runLimitedRepair } from "./repair.ts";
import { stage } from "./stage.ts";
import { runValidate } from "./validate.ts";
import { readJsonFile } from "./model-io.ts";
import { runPaths } from "./paths.ts";

export type JobInput = {
  jobsRoot: string;
  jobId?: string;
  runDir?: string;
  from?: string;
  url?: string;
  adapters: AdapterMode;
  force?: boolean;
  seed?: string | true;
  env?: NodeJS.Dict<string>;
  parser?: "python" | "http";
};

function errorMessage(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function record(
  job: JobRecord,
  stageName: JobStage,
  module: string,
  startedAt: number,
  outcome: StageOutcome,
  extra?: { error?: string; diagnostics?: Record<string, unknown> },
): Promise<void> {
  const run: RunRecord = {
    id: randomUUID(),
    jobId: job.id,
    stage: stageName,
    module,
    outcome,
    durationMs: Date.now() - startedAt,
    error: extra?.error,
    diagnostics: extra?.diagnostics ?? {},
    startedAt,
  };
  await appendRun(job.runDir, run);
}

async function parserDiagnostics(runDir: string): Promise<Record<string, unknown>> {
  try {
    return (await readJsonFile(path.join(runPaths(runDir).parser, "diagnostics.json"))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function executeListingJob(input: JobInput): Promise<JobView> {
  const id = input.jobId ?? randomUUID();
  const runDir = path.resolve(input.runDir ?? path.join(input.jobsRoot, id));
  await mkdir(runDir, { recursive: true });
  const env = input.env ?? process.env;
  const now = Date.now();
  const existing = await readJobRecord(runDir);
  const job: JobRecord = {
    id,
    status: "running",
    stage: "import",
    adapters: input.adapters,
    listingUrl: input.url,
    from: input.from,
    runDir,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeJobRecord(job);

  const fail = async (stageName: JobStage, error: unknown, outcome: StageOutcome = "failure"): Promise<JobView> => {
    job.status = "failed";
    job.stage = stageName;
    job.error = errorMessage(error);
    await writeJobRecord(job);
    return ingestJobArtifacts({
      jobsRoot: input.jobsRoot,
      jobId: id,
      runDir,
      adapters: input.adapters,
      status: "failed",
      stage: stageName,
      error: job.error,
      listingUrl: input.url,
      from: input.from,
    });
  };

  try {
    stage("import", input.adapters);
    const importStarted = Date.now();
    job.stage = "import";
    await writeJobRecord(job);
    await runImport(
      {
        help: false,
        force: input.force ?? true,
        command: "import",
        runDir,
        from: input.from,
        url: input.url,
        seed: input.seed,
        adapters: input.adapters,
      },
      input.adapters,
    );
    await record(job, "import", "importer@0.1", importStarted, "success");
  } catch (error) {
    const importStarted = Date.now();
    await record(job, "import", "importer@0.1", importStarted, "failure", { error: errorMessage(error) });
    return fail("import", error);
  }

  try {
    stage("parse", "python plan_parser / PARSER_URL → grok-rects fallback");
    const started = Date.now();
    job.stage = "parse";
    await writeJobRecord(job);
    await runParse(runDir, input.adapters, { env, parser: input.parser });
    const diagnostics = await parserDiagnostics(runDir);
    const python = diagnostics.python as { outcome?: string } | undefined;
    await record(job, "parse", "plan-parser@0.1", started, "success", { diagnostics });
    if (python?.outcome === "unavailable") {
      diagnostics.parseNote = "Python/HTTP parser unavailable; grok-rects ran only if a live/fixture patch existed";
    }
  } catch (error) {
    const started = Date.now();
    const diagnostics = await parserDiagnostics(runDir);
    await record(job, "parse", "plan-parser@0.1", started, "failure", {
      error: errorMessage(error),
      diagnostics,
    });
    return fail("parse", error);
  }

  let report;
  try {
    stage("validate");
    const started = Date.now();
    job.stage = "validate";
    await writeJobRecord(job);
    report = await runValidate(runDir);
    await record(job, "validate", "validator@0.1", started, "success", {
      diagnostics: { modelId: report.modelId, revision: report.revision, walkReady: report.walkReady },
    });
  } catch (error) {
    const started = Date.now();
    await record(job, "validate", "validator@0.1", started, "failure", { error: errorMessage(error) });
    return fail("validate", error);
  }

  try {
    stage("repair", "runGeometryRepair; proposeRepair is not called");
    const started = Date.now();
    job.stage = "repair";
    await writeJobRecord(job);
    const repair = await runLimitedRepair(runDir, input.adapters, undefined, env);
    if (repair === "applied") report = await runValidate(runDir);
    await record(job, "repair", "geometry-repair@0.1", started, repair === "applied" ? "success" : "skipped", {
      diagnostics: { persist: repair },
    });
  } catch (error) {
    const started = Date.now();
    await record(job, "repair", "geometry-repair@0.1", started, "failure", { error: errorMessage(error) });
    return fail("repair", error);
  }

  const matchStarted = Date.now();
  job.stage = "match";
  await writeJobRecord(job);
  await record(job, "match", "photo-matcher@0.1", matchStarted, "unavailable", {
    diagnostics: {
      reason: "Matcher owner has not supplied an integration handoff for listing 54541; optional dressing is not required for a usable 3D result",
    },
  });
  console.log("match: unavailable (no Matcher handoff). 3D result is not blocked.");

  const dressStarted = Date.now();
  job.stage = "dress";
  await writeJobRecord(job);
  await record(job, "dress", "dresser@0.1", dressStarted, "unavailable", {
    diagnostics: { reason: "Dresser L1/L2 public apply API is not exported" },
  });
  console.log("dress: unavailable. Geometry-only model is published.");

  try {
    stage("build");
    const started = Date.now();
    job.stage = "publish";
    await writeJobRecord(job);
    await runBuild(runDir);
    await record(job, "publish", "builder@0.1", started, "success");
  } catch (error) {
    const started = Date.now();
    await record(job, "publish", "builder@0.1", started, "failure", { error: errorMessage(error) });
    return fail("publish", error);
  }

  job.status = "succeeded";
  job.stage = "publish";
  await writeJobRecord(job);
  const view = await ingestJobArtifacts({
    jobsRoot: input.jobsRoot,
    jobId: id,
    runDir,
    adapters: input.adapters,
    status: "succeeded",
    stage: "publish",
    listingUrl: input.url,
    from: input.from,
  });
  if (view.model && view.report) printPipelineOutcome(view.model, view.report, runDir);
  return view;
}

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  RevisionContextSchema,
  ValidationReportSchema,
  type FlatModel,
  type RevisionContext,
  type ValidationReport,
} from "@flatwalk/contract";
import type { ListingBundle } from "@flatwalk/firecrawl";
import { parseModel, readJsonFile } from "./model-io.ts";
import { runPaths } from "./paths.ts";

export type JobStatus = "queued" | "running" | "waiting_for_review" | "succeeded" | "failed" | "cancelled";
export type JobStage = "import" | "parse" | "validate" | "repair" | "match" | "dress" | "publish";
export type StageOutcome = "success" | "failure" | "unavailable" | "skipped";
export type AdapterMode = "fixture" | "live";

export type JobRecord = {
  id: string;
  status: JobStatus;
  stage: JobStage;
  adapters: AdapterMode;
  listingUrl?: string;
  from?: string;
  modelId?: string;
  revision?: number;
  walkReady?: boolean;
  error?: string;
  runDir: string;
  createdAt: number;
  updatedAt: number;
};

export type RunRecord = {
  id: string;
  jobId: string;
  stage: JobStage;
  module: string;
  outcome: StageOutcome;
  durationMs: number;
  error?: string;
  diagnostics: Record<string, unknown>;
  startedAt: number;
};

export type MaterialRef = {
  assetId: string;
  kind: string;
  url: string;
  localPath: string;
};

export type JobView = {
  job: JobRecord;
  runs: RunRecord[];
  model?: FlatModel;
  report?: ValidationReport;
  history?: RevisionContext;
  materials: MaterialRef[];
  listing?: ListingBundle;
};

export function jobFile(runDir: string): string {
  return path.join(runDir, "job.json");
}

export function runsFile(runDir: string): string {
  return path.join(runDir, "runs.json");
}

export async function writeJobRecord(job: JobRecord): Promise<void> {
  job.updatedAt = Date.now();
  await writeFile(jobFile(job.runDir), `${JSON.stringify(job, null, 2)}\n`);
}

export async function readJobRecord(runDir: string): Promise<JobRecord | undefined> {
  try {
    return JSON.parse(await readFile(jobFile(runDir), "utf8")) as JobRecord;
  } catch {
    return undefined;
  }
}

export async function readRuns(runDir: string): Promise<RunRecord[]> {
  try {
    return JSON.parse(await readFile(runsFile(runDir), "utf8")) as RunRecord[];
  } catch {
    return [];
  }
}

export async function appendRun(runDir: string, run: RunRecord): Promise<void> {
  const runs = await readRuns(runDir);
  runs.push(run);
  await writeFile(runsFile(runDir), `${JSON.stringify(runs, null, 2)}\n`);
}

async function loadOptionalModel(runDir: string): Promise<FlatModel | undefined> {
  try {
    return parseModel(await readJsonFile(runPaths(runDir).latest), runPaths(runDir).latest);
  } catch {
    return undefined;
  }
}

async function loadOptionalHistory(runDir: string, model: FlatModel | undefined): Promise<RevisionContext | undefined> {
  if (!model) return undefined;
  try {
    const parsed = RevisionContextSchema.safeParse(await readJsonFile(runPaths(runDir).history));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function loadOptionalReport(runDir: string, model: FlatModel | undefined): Promise<ValidationReport | undefined> {
  if (!model) return undefined;
  const file = path.join(runPaths(runDir).validation, `rev-${String(model.revision).padStart(3, "0")}.json`);
  try {
    const parsed = ValidationReportSchema.safeParse(await readJsonFile(file));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function loadListing(runDir: string): Promise<ListingBundle | undefined> {
  try {
    return (await readJsonFile(runPaths(runDir).listing)) as ListingBundle;
  } catch {
    return undefined;
  }
}

export function materialRefs(runDir: string, listing: ListingBundle | undefined, model?: FlatModel): MaterialRef[] {
  const refs: MaterialRef[] = [];
  if (listing?.assets) {
    for (const [assetId, asset] of Object.entries(listing.assets)) {
      const localPath = asset.localPath.replace(/^\.\//, "");
      refs.push({
        assetId,
        kind: asset.kind,
        url: localPath.startsWith("materials/") ? localPath : `materials/${path.basename(localPath)}`,
        localPath: path.resolve(runDir, localPath),
      });
    }
    return refs;
  }
  if (model?.assets) {
    for (const [assetId, asset] of Object.entries(model.assets)) {
      if (/^(https?:|data:|blob:)/i.test(asset.url)) {
        refs.push({ assetId, kind: asset.kind, url: asset.url, localPath: asset.url });
        continue;
      }
      const cleaned = asset.url.replace(/^\.\//, "");
      refs.push({
        assetId,
        kind: asset.kind,
        url: cleaned,
        localPath: path.resolve(runDir, cleaned),
      });
    }
  }
  return refs;
}

export async function ingestJobArtifacts(options: {
  jobsRoot: string;
  jobId: string;
  runDir: string;
  adapters: AdapterMode;
  status: JobStatus;
  stage: JobStage;
  error?: string;
  listingUrl?: string;
  from?: string;
}): Promise<JobView> {
  const model = await loadOptionalModel(options.runDir);
  const report = await loadOptionalReport(options.runDir, model);
  const history = await loadOptionalHistory(options.runDir, model);
  const listing = await loadListing(options.runDir);
  const existing = await readJobRecord(options.runDir);
  const job: JobRecord = {
    id: options.jobId,
    status: options.status,
    stage: options.stage,
    adapters: options.adapters,
    listingUrl: options.listingUrl ?? existing?.listingUrl,
    from: options.from ?? existing?.from,
    modelId: model?.id,
    revision: model?.revision,
    walkReady: report?.walkReady,
    error: options.error ?? existing?.error,
    runDir: path.resolve(options.runDir),
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  await writeJobRecord(job);
  const runs = await readRuns(options.runDir);
  return {
    job,
    runs,
    model,
    report,
    history,
    listing,
    materials: materialRefs(options.runDir, listing, model),
  };
}

export async function listJobDirs(jobsRoot: string): Promise<string[]> {
  try {
    const names = await readdir(jobsRoot, { withFileTypes: true });
    return names.filter((entry) => entry.isDirectory()).map((entry) => path.join(jobsRoot, entry.name));
  } catch {
    return [];
  }
}

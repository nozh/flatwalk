import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createGrokClient } from "@flatwalk/ai";
import {
  runGeometryRepair,
  type GeometryRepairAttempt,
  type GeometryRepairClient,
  type GeometryRepairOutput,
} from "@flatwalk/ai/geometry-repair";
import { RevisionContextSchema, type FlatModel, type ValidationReport } from "@flatwalk/contract";
import type { AdapterMode } from "./adapters.ts";
import { CliError, EXIT } from "./errors.ts";
import { appendPublishedChange, loadHistory, publishRevision } from "./history.ts";
import { requireRunDir } from "./layout.ts";
import { loadLatestModel } from "./model-io.ts";
import { nextPatchFile } from "./patch-apply.ts";
import { runPaths } from "./paths.ts";

export type RepairPersistResult = "applied" | "skipped";

function isAcceptedStep(step: GeometryRepairAttempt, previousRevision: number): boolean {
  return (
    step.patch != null &&
    step.model != null &&
    step.apply != null &&
    step.apply.revision === step.model.revision &&
    step.model.revision === previousRevision + 1
  );
}

function requirePersistFields(step: GeometryRepairAttempt): void {
  if (!step.patch || !step.model || !step.apply) {
    throw new CliError(
      EXIT.model,
      "runGeometryRepair accepted a revision without model/patch/touchedPaths. Repair owner must expose those on attempts; CLI will not re-apply result.patch.",
    );
  }
  if (!step.apply.touchedPaths || !step.apply.touchedOwners) {
    throw new CliError(
      EXIT.model,
      "runGeometryRepair attempt is missing touchedPaths/touchedOwners needed for RevisionContext.",
    );
  }
}

async function writeReport(runDir: string, report: ValidationReport | undefined, revision: number): Promise<void> {
  if (!report) return;
  const parsed = report.modelId && report.revision === revision ? report : undefined;
  if (!parsed) return;
  const file = path.join(runPaths(runDir).validation, `rev-${String(revision).padStart(3, "0")}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
}

export async function persistGeometryRepair(
  runDir: string,
  baseline: FlatModel,
  result: GeometryRepairOutput,
): Promise<RepairPersistResult> {
  const paths = runPaths(runDir);
  await writeFile(path.join(paths.parser, "geometry-repair.json"), `${JSON.stringify({
    stopped: result.stopped,
    diagnostics: result.diagnostics,
    attempts: result.attempts.map((step) => ({
      attempt: step.attempt,
      baseRevision: step.baseRevision,
      revision: step.apply?.revision ?? step.model?.revision,
      rejected: step.apply?.rejected ?? [],
      reason: step.reason,
    })),
  }, null, 2)}\n`);

  let previous = baseline;
  let history = await loadHistory(paths.root, previous);
  let published = 0;

  for (const step of result.attempts) {
    if (!step.patch || !step.apply || step.apply.revision === step.baseRevision) {
      continue;
    }
    requirePersistFields(step);
    if (!isAcceptedStep(step, previous.revision)) {
      throw new CliError(
        EXIT.model,
        `repair attempt ${step.attempt} is not the next sequential revision after ${previous.revision}`,
      );
    }
    const next = step.model!;
    const patch = step.patch;
    const nextHistory = appendPublishedChange(history, previous, next, {
      touchedPaths: step.apply.touchedPaths,
      touchedOwners: step.apply.touchedOwners,
    });
    const parsedHistory = RevisionContextSchema.safeParse(nextHistory);
    if (!parsedHistory.success) {
      throw new CliError(EXIT.model, "Repair history is not a valid RevisionContext");
    }
    const patchFile = await nextPatchFile(paths.patches, patch.module);
    await publishRevision({
      runDir: paths.root,
      previous,
      previousHistory: history,
      next,
      patch,
      history: parsedHistory.data,
      patchFile,
    });
    await writeReport(paths.root, step.nextReport, next.revision);
    if (step.apply.rejected.length > 0) {
      console.log(
        `repair: rev ${next.revision} stored with ${step.apply.rejected.length} rejected op(s); not re-applied`,
      );
    } else {
      console.log(`repair: stored Resolver snapshot ${next.id} rev ${next.revision} → ${patchFile}`);
    }
    previous = next;
    history = parsedHistory.data;
    published += 1;
  }

  const latest = await loadLatestModel(paths.root);
  if (latest.revision !== result.model.revision || latest.id !== result.model.id) {
    throw new CliError(
      EXIT.model,
      `Persisted latest rev ${latest.revision} does not match runGeometryRepair result.model rev ${result.model.revision}`,
    );
  }
  return published > 0 ? "applied" : "skipped";
}

export async function runLimitedRepair(
  runDir: string,
  adapters: AdapterMode,
  grok?: GeometryRepairClient,
  env: NodeJS.Dict<string> = process.env,
): Promise<RepairPersistResult> {
  const paths = await requireRunDir(runDir);
  const model = await loadLatestModel(paths.root);
  const client =
    grok ??
    createGrokClient({
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
  console.log("repair: runGeometryRepair from @flatwalk/ai/geometry-repair (proposeRepair is not called)");
  const result = await runGeometryRepair({ model, grok: client });
  console.log(`repair: stopped=${result.stopped} attempts=${result.attempts.length}`);
  if (result.diagnostics.synthetic === true) {
    console.log("repair: synthetic geometry-repair fixture, not a live x.ai result");
  }
  return persistGeometryRepair(paths.root, model, result);
}

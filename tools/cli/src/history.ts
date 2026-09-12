import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { RevisionContextSchema, type FlatModel, type Patch, type RevisionContext } from "@flatwalk/contract";
import type { ApplyResult } from "@flatwalk/resolver";
import { CliError, EXIT } from "./errors.ts";
import { runPaths } from "./paths.ts";

export function emptyHistory(model: FlatModel): RevisionContext {
  return {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: 0,
    currentRevision: model.revision,
    changes: [],
  };
}

export async function loadHistory(runDir: string, model: FlatModel): Promise<RevisionContext | undefined> {
  const file = runPaths(runDir).history;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = RevisionContextSchema.safeParse(JSON.parse(text) as unknown);
  if (!parsed.success) {
    throw new CliError(EXIT.model, `Public Contract rejected ${file}`);
  }
  if (parsed.data.modelId !== model.id || parsed.data.currentRevision !== model.revision) {
    throw new CliError(
      EXIT.model,
      `Saved history ${file} does not match model ${model.id} rev ${model.revision}`,
    );
  }
  return parsed.data;
}

export function contextForPatch(
  journal: RevisionContext | undefined,
  model: FlatModel,
  patch: Patch,
): RevisionContext {
  if (!journal) {
    if (patch.baseRevision !== model.revision) {
      throw new CliError(
        EXIT.model,
        "Revision history is missing; refusing an empty touchedSince across a revision gap",
      );
    }
    return {
      schemaVersion: "0.1",
      modelId: model.id,
      baseRevision: patch.baseRevision,
      currentRevision: model.revision,
      changes: [],
    };
  }
  return {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: patch.baseRevision,
    currentRevision: model.revision,
    changes: journal.changes.filter(
      (change) => change.revision > patch.baseRevision && change.revision <= model.revision,
    ),
  };
}

export function appendPublishedChange(
  journal: RevisionContext | undefined,
  previous: FlatModel,
  next: FlatModel,
  change: { touchedPaths: string[]; touchedOwners: string[] },
): RevisionContext {
  if (next.revision !== previous.revision + 1) {
    throw new CliError(
      EXIT.model,
      `Cannot append history from rev ${previous.revision} to ${next.revision}; sequential revisions required`,
    );
  }
  const previousJournal = journal ?? emptyHistory(previous);
  return {
    schemaVersion: "0.1",
    modelId: next.id,
    baseRevision: 0,
    currentRevision: next.revision,
    changes: [
      ...previousJournal.changes,
      {
        revision: next.revision,
        touchedPaths: change.touchedPaths,
        touchedOwners: change.touchedOwners,
      },
    ],
  };
}

export function appendHistory(
  journal: RevisionContext | undefined,
  model: FlatModel,
  applied: ApplyResult,
): RevisionContext {
  return appendPublishedChange(journal, model, applied.model, {
    touchedPaths: applied.touchedPaths,
    touchedOwners: applied.touchedOwners,
  });
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

export async function writeHistory(runDir: string, history: RevisionContext): Promise<void> {
  await writeJsonAtomic(runPaths(runDir).history, history);
}

export async function publishRevision(options: {
  runDir: string;
  previous: FlatModel;
  previousHistory: RevisionContext | undefined;
  next: FlatModel;
  patch: Patch;
  history: RevisionContext;
  patchFile: string;
}): Promise<void> {
  const paths = runPaths(options.runDir);
  const revFile = paths.revision(options.next.revision);
  try {
    await writeJsonAtomic(options.patchFile, options.patch);
    await writeJsonAtomic(revFile, options.next);
    await writeJsonAtomic(paths.history, options.history);
    await writeJsonAtomic(paths.latest, options.next);
  } catch (error) {
    await rm(revFile, { force: true });
    await rm(options.patchFile, { force: true });
    await writeJsonAtomic(paths.latest, options.previous);
    if (options.previousHistory) await writeJsonAtomic(paths.history, options.previousHistory);
    else await rm(paths.history, { force: true });
    throw error;
  }
}

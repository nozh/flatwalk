import { readFile, writeFile } from "node:fs/promises";
import { validateFlatModel, type FlatModel } from "@flatwalk/contract";
import { CliError, EXIT, formatZodIssues } from "./errors.ts";
import { runPaths } from "./paths.ts";

export async function readJsonFile(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(EXIT.model, `File not found: ${file}`);
    }
    throw new CliError(EXIT.io, `Cannot read ${file}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError(EXIT.model, `Invalid JSON: ${file}`);
  }
}

export function parseModel(input: unknown, origin: string): FlatModel {
  const parsed = validateFlatModel(input);
  if (!parsed.success) {
    throw new CliError(
      EXIT.model,
      `Public Contract rejected ${origin}`,
      formatZodIssues(parsed.error.issues),
    );
  }
  return parsed.data;
}

export async function loadModelFile(file: string): Promise<FlatModel> {
  return parseModel(await readJsonFile(file), file);
}

export async function writeModelFiles(runDir: string, model: FlatModel): Promise<{ latest: string; revision: string }> {
  const paths = runPaths(runDir);
  const json = `${JSON.stringify(model, null, 2)}\n`;
  const revision = paths.revision(model.revision);
  await writeFile(revision, json);
  await writeFile(paths.latest, json);
  return { latest: paths.latest, revision };
}

export async function loadLatestModel(runDir: string): Promise<FlatModel> {
  const latest = runPaths(runDir).latest;
  try {
    return await loadModelFile(latest);
  } catch (error) {
    if (error instanceof CliError && error.message.startsWith("File not found")) {
      throw new CliError(
        EXIT.model,
        `No model at ${latest}. Seed the fixture with import --seed, or place a FlatModel at model/latest.json.`,
      );
    }
    throw error;
  }
}

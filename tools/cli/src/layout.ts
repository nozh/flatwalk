import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { CliError, EXIT } from "./errors.ts";
import { RUN_SUBDIRS, runPaths } from "./paths.ts";

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function isNonEmptyRun(root: string): Promise<boolean> {
  if (!(await exists(root))) return false;
  const entries = await readdir(root);
  if (entries.length === 0) return false;
  const paths = runPaths(root);
  for (const name of RUN_SUBDIRS) {
    if (await exists(paths[name])) return true;
  }
  return entries.length > 0;
}

export async function prepareRunDir(runDir: string, force: boolean): Promise<ReturnType<typeof runPaths>> {
  const paths = runPaths(runDir);
  if (await isNonEmptyRun(paths.root)) {
    if (!force) {
      throw new CliError(
        EXIT.runFolder,
        `Run directory already exists: ${paths.root}. Pass --force to replace it. The source fixture is never overwritten.`,
      );
    }
    await rm(paths.root, { recursive: true, force: true });
  }
  await mkdir(paths.root, { recursive: true });
  for (const name of RUN_SUBDIRS) {
    await mkdir(paths[name], { recursive: true });
  }
  return paths;
}

export async function requireRunDir(runDir: string): Promise<ReturnType<typeof runPaths>> {
  const paths = runPaths(runDir);
  if (!(await exists(paths.root))) {
    throw new CliError(
      EXIT.runFolder,
        `Run directory not found: ${paths.root}. Create it with: flatwalk import ${runDir} --from fixtures/54541`,
    );
  }
  for (const name of RUN_SUBDIRS) {
    await mkdir(paths[name], { recursive: true });
  }
  return paths;
}

import { access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { repoRoot } from "./paths.ts";

export async function resolveExistingPath(input: string): Promise<string | undefined> {
  const candidates = [path.resolve(input)];
  if (!path.isAbsolute(input)) {
    candidates.push(path.resolve(repoRoot(), input));
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      await access(candidate, constants.F_OK);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function defaultFixtureDir(): string {
  return path.join(repoRoot(), "fixtures", "54541");
}

export function defaultSeedModel(): string {
  return path.join(defaultFixtureDir(), "flat.model.json");
}

import { readdir } from "node:fs/promises";
import path from "node:path";
import type { FlatModel, Patch } from "@flatwalk/contract";
import { apply } from "@flatwalk/resolver";
import { CliError, EXIT } from "./errors.ts";
import { appendHistory, contextForPatch, loadHistory, publishRevision } from "./history.ts";
import { loadLatestModel } from "./model-io.ts";
import { runPaths } from "./paths.ts";

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

function patchSlug(module: string): string {
  return module.replace(/@[\d.]+$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
}

export async function nextPatchFile(patchesDir: string, module: string): Promise<string> {
  const names = await readdir(patchesDir).catch(() => [] as string[]);
  let max = 0;
  for (const name of names) {
    const match = /^(\d{3})-/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return path.join(patchesDir, `${pad(max + 1)}-${patchSlug(module)}.json`);
}

export async function applyPublishedPatch(
  runDir: string,
  patch: Patch,
  refuseMessage: string,
): Promise<{ previous: FlatModel; next: FlatModel; patchFile: string }> {
  const paths = runPaths(runDir);
  const model = await loadLatestModel(paths.root);
  const previous = structuredClone(model);
  const history = await loadHistory(paths.root, model);
  const context = contextForPatch(history, model, patch);
  const applied = apply(model, patch, context);
  if (applied.rejected.length > 0 || applied.model.revision === model.revision) {
    throw new CliError(
      EXIT.model,
      refuseMessage,
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
  return { previous, next: applied.model, patchFile };
}

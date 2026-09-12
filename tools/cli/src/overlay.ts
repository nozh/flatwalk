import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderOverlay } from "@flatwalk/builder/node";
import type { FlatModel } from "@flatwalk/contract";
import { runPaths } from "./paths.ts";

export async function writeAcceptedOverlay(runDir: string, model: FlatModel, planPath: string): Promise<string | undefined> {
  const png = new Uint8Array(await readFile(planPath));
  const overlay = await renderOverlay(model, png);
  const file = path.join(runPaths(runDir).parser, `overlay-rev-${String(model.revision).padStart(3, "0")}.png`);
  await writeFile(file, Buffer.from(overlay.png));
  if (overlay.schemePng) {
    await writeFile(
      path.join(runPaths(runDir).parser, `overlay-scheme-rev-${String(model.revision).padStart(3, "0")}.png`),
      Buffer.from(overlay.schemePng),
    );
  }
  await writeFile(
    path.join(runPaths(runDir).parser, `overlay-rev-${String(model.revision).padStart(3, "0")}.meta.json`),
    `${JSON.stringify(overlay.meta, null, 2)}\n`,
  );
  console.log(`parse: overlay ${overlay.meta.kind} → ${file} (model ${overlay.meta.modelId} rev ${overlay.meta.revision})`);
  return file;
}

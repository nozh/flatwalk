import { writeFile } from "node:fs/promises";
import { build, snapshot, toGLB, BuilderError } from "@flatwalk/builder";
import { CliError, EXIT } from "./errors.ts";
import { requireRunDir } from "./layout.ts";
import { loadLatestModel } from "./model-io.ts";

export async function runBuild(runDir: string): Promise<void> {
  const paths = await requireRunDir(runDir);
  const model = await loadLatestModel(paths.root);
  try {
    const group = build(model);
    const snap = snapshot(group);
    const glb = await toGLB(group);
    await writeFile(paths.snapshot, `${JSON.stringify(snap, null, 2)}\n`);
    await writeFile(paths.glb, Buffer.from(glb));
    console.log(`build: Builder snapshot → ${paths.snapshot} (${snap.length} meshes)`);
    console.log(`build: Builder GLB → ${paths.glb} (${glb.byteLength} bytes)`);
  } catch (error) {
    if (error instanceof BuilderError) {
      throw new CliError(EXIT.model, `Builder refused the model (${error.code}): ${error.message}`, error.issues);
    }
    throw error;
  }
}

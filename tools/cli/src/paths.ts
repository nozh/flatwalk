import path from "node:path";
import { fileURLToPath } from "node:url";

/** `code/flatwalk-repo` — parent of `tools/`. */
export function repoRoot(fromFile = import.meta.url): string {
  return path.resolve(path.dirname(fileURLToPath(fromFile)), "../../..");
}

export const RUN_SUBDIRS = [
  "materials",
  "model",
  "patches",
  "parser",
  "validation",
  "dressing",
  "build",
] as const;

export function runPaths(runDir: string) {
  const root = path.resolve(runDir);
  return {
    root,
    materials: path.join(root, "materials"),
    model: path.join(root, "model"),
    patches: path.join(root, "patches"),
    parser: path.join(root, "parser"),
    validation: path.join(root, "validation"),
    dressing: path.join(root, "dressing"),
    build: path.join(root, "build"),
    latest: path.join(root, "model", "latest.json"),
    listing: path.join(root, "materials", "listing.json"),
    glb: path.join(root, "build", "flat.glb"),
    snapshot: path.join(root, "build", "scene.snapshot.json"),
    revision(n: number) {
      return path.join(root, "model", `rev-${String(n).padStart(3, "0")}.json`);
    },
  };
}

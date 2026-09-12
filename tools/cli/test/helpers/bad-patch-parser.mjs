#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const payload = {
  patch: {
    schemaVersion: "0.1",
    modelId: "wrong-listing",
    baseRevision: 0,
    module: "plan-parser@0.1",
    ops: [{ op: "set", path: "flat.defaults.wallHeight", value: 3.1 }],
  },
};
const text = `${JSON.stringify(payload, null, 2)}\n`;
process.stdout.write(text);
if (outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "result.json"), text);
}

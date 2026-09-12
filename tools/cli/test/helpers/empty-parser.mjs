#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;
const payload = { patch: null, reason: "not-implemented" };
const text = `${JSON.stringify(payload, null, 2)}\n`;
process.stdout.write(text);
if (outDir) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "result.json"), text);
}

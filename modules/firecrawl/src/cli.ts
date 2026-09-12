#!/usr/bin/env npx tsx
import path from "node:path";
import { config } from "dotenv";
import { fetchListing } from "./index.js";

config({ path: path.resolve(process.cwd(), ".env") });
config({ path: path.resolve(process.cwd(), "modules/firecrawl/.env") });

function parseArgs(argv: string[]): { url: string; out: string } {
  const args = argv.slice(2);
  let out = path.resolve("assets");
  const rest: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--out" || arg === "-o") {
      const value = args[i + 1];
      if (!value) throw new Error("--out requires a path");
      out = path.resolve(value);
      i += 1;
      continue;
    }
    rest.push(arg);
  }

  const url = rest[0];
  if (!url) {
    throw new Error(
      "Usage: npm run fetch -- <listing-url> [--out assets]\nFiles are stored in <out>/<listingId>/",
    );
  }
  return { url, out };
}

async function main(): Promise<void> {
  const { url, out } = parseArgs(process.argv);
  const bundle = await fetchListing({ url, assetsDir: out });
  const files = Object.values(bundle.assets);
  const plans = files.filter((asset) => asset.kind === "plan");
  const photos = files.filter((asset) => asset.kind === "photo");
  const listingDir = path.dirname(files[0]?.localPath ?? path.join(out, bundle.source.listingId ?? ""));
  console.log(`Saved ${files.length} files to ${listingDir}`);
  for (const plan of plans) console.log(`plan: ${plan.localPath}`);
  console.log(`photos: ${photos.length}`);
  console.log(`manifest: ${path.join(listingDir, "listing.json")}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

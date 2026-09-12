"use node";

import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeListingJob } from "../tools/cli/src/job.ts";
import { ingestJobArtifacts } from "../tools/cli/src/job-store.ts";

/**
 * Node action: the existing CLI job engine. Persist blobs with jobs.submitListing
 * after `npx convex dev` / deploy. Keys stay in Convex env, never VITE_*.
 */
export const processListing = actionGeneric({
  args: {
    url: v.optional(v.string()),
    from: v.optional(v.string()),
    adapters: v.optional(v.union(v.literal("fixture"), v.literal("live"))),
  },
  handler: async (_ctx, args) => {
    const adapters = args.adapters ?? (args.url ? "live" : "fixture");
    const jobsRoot = await mkdtemp(path.join(os.tmpdir(), "flatwalk-convex-"));
    const view = await executeListingJob({
      jobsRoot,
      from: args.from,
      url: args.url,
      adapters,
      force: true,
      parser: process.env.PARSER_URL ? "http" : "python",
      env: process.env,
    });
    const published = await ingestJobArtifacts({
      jobsRoot,
      jobId: view.job.id,
      runDir: view.job.runDir,
      adapters,
      status: view.job.status,
      stage: view.job.stage,
      error: view.job.error,
      listingUrl: args.url,
      from: args.from,
    });
    const files: string[] = [];
    async function walk(dir: string, prefix: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const rel = path.join(prefix, entry.name);
        if (entry.isDirectory()) await walk(full, rel);
        else files.push(rel);
      }
    }
    await walk(view.job.runDir, "");
    return {
      job: published.job,
      runs: published.runs,
      modelId: published.model?.id,
      revision: published.model?.revision,
      reportRevision: published.report?.revision,
      materials: published.materials.map((item) => item.url),
      artifactFiles: files,
    };
  },
});

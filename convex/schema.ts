import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Planned Convex tables for the listing job slice (deploy.md §4). */
export default defineSchema({
  listings: defineTable({
    jobId: v.string(),
    listingId: v.string(),
    sourceUrl: v.optional(v.string()),
    bundle: v.any(),
  }).index("by_job", ["jobId"]),
  models: defineTable({
    jobId: v.string(),
    modelId: v.string(),
    revision: v.number(),
    model: v.any(),
    history: v.optional(v.any()),
  }).index("by_job_revision", ["jobId", "revision"]),
  jobs: defineTable({
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("waiting_for_review"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    stage: v.union(
      v.literal("import"),
      v.literal("parse"),
      v.literal("validate"),
      v.literal("repair"),
      v.literal("match"),
      v.literal("dress"),
      v.literal("publish"),
    ),
    adapters: v.union(v.literal("fixture"), v.literal("live")),
    listingUrl: v.optional(v.string()),
    from: v.optional(v.string()),
    modelId: v.optional(v.string()),
    revision: v.optional(v.number()),
    walkReady: v.optional(v.boolean()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  runs: defineTable({
    jobId: v.string(),
    stage: v.string(),
    module: v.string(),
    outcome: v.union(
      v.literal("success"),
      v.literal("failure"),
      v.literal("unavailable"),
      v.literal("skipped"),
    ),
    durationMs: v.number(),
    error: v.optional(v.string()),
    diagnostics: v.any(),
    startedAt: v.number(),
  }).index("by_job", ["jobId"]),
  reports: defineTable({
    jobId: v.string(),
    modelId: v.string(),
    revision: v.number(),
    report: v.any(),
  }).index("by_job_revision", ["jobId", "revision"]),
  materials: defineTable({
    jobId: v.string(),
    assetId: v.string(),
    kind: v.string(),
    storageId: v.optional(v.id("_storage")),
    url: v.string(),
  }).index("by_job", ["jobId"]),
});

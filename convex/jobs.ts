import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const submitListing = mutationGeneric({
  args: {
    url: v.optional(v.string()),
    from: v.optional(v.string()),
    adapters: v.optional(v.union(v.literal("fixture"), v.literal("live"))),
  },
  handler: async (ctx, args) => {
    const adapters = args.adapters ?? (args.url ? "live" : "fixture");
    if (!args.url && !args.from) {
      throw new Error("submitListing requires url or from");
    }
    if (args.url && adapters !== "live") {
      throw new Error("listing URL requires adapters: live");
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      status: "queued",
      stage: "import",
      adapters,
      listingUrl: args.url,
      from: args.from,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId };
  },
});

export const persistJob = mutationGeneric({
  args: {
    jobId: v.id("jobs"),
    status: v.string(),
    stage: v.string(),
    modelId: v.optional(v.string()),
    revision: v.optional(v.number()),
    walkReady: v.optional(v.boolean()),
    error: v.optional(v.string()),
    model: v.optional(v.any()),
    history: v.optional(v.any()),
    report: v.optional(v.any()),
    runs: v.array(v.any()),
    listing: v.optional(v.any()),
    materials: v.array(
      v.object({
        assetId: v.string(),
        kind: v.string(),
        url: v.string(),
        storageId: v.optional(v.id("_storage")),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error(`Unknown job ${args.jobId}`);
    await ctx.db.patch(args.jobId, {
      status: args.status,
      stage: args.stage,
      modelId: args.modelId,
      revision: args.revision,
      walkReady: args.walkReady,
      error: args.error,
      updatedAt: Date.now(),
    });
    if (args.listing) {
      await ctx.db.insert("listings", {
        jobId: args.jobId,
        listingId: args.modelId ?? "unknown",
        sourceUrl: job.listingUrl,
        bundle: args.listing,
      });
    }
    if (args.model && args.modelId && args.revision !== undefined) {
      await ctx.db.insert("models", {
        jobId: args.jobId,
        modelId: args.modelId,
        revision: args.revision,
        model: args.model,
        history: args.history,
      });
    }
    if (args.report && args.modelId && args.revision !== undefined) {
      await ctx.db.insert("reports", {
        jobId: args.jobId,
        modelId: args.modelId,
        revision: args.revision,
        report: args.report,
      });
    }
    for (const run of args.runs) {
      await ctx.db.insert("runs", { ...run, jobId: args.jobId });
    }
    for (const material of args.materials) {
      await ctx.db.insert("materials", { ...material, jobId: args.jobId });
    }
    return args.jobId;
  },
});

export const getJob = queryGeneric({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const materials = await ctx.db
      .query("materials")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .collect();
    const reports = job.modelId
      ? await ctx.db
          .query("reports")
          .withIndex("by_job_revision", (q) => q.eq("jobId", args.jobId).eq("revision", job.revision ?? -1))
          .collect()
      : [];
    const models = job.modelId
      ? await ctx.db
          .query("models")
          .withIndex("by_job_revision", (q) => q.eq("jobId", args.jobId).eq("revision", job.revision ?? -1))
          .collect()
      : [];
    const resolvedMaterials = await Promise.all(
      materials.map(async (item) => ({
        ...item,
        url: item.storageId ? ((await ctx.storage.getUrl(item.storageId)) ?? item.url) : item.url,
      })),
    );
    return {
      job,
      runs,
      materials: resolvedMaterials,
      model: models[0]?.model,
      history: models[0]?.history,
      report: reports[0]?.report,
    };
  },
});

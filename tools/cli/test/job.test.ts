import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runGeometryRepair, type GeometryRepairClient } from "@flatwalk/ai/geometry-repair";
import type { FlatModel, ValidationReport } from "@flatwalk/contract";
import { executeListingJob } from "../src/job.ts";
import { handleJobHttp, type JobApi } from "../src/job-http.ts";
import { ingestJobArtifacts } from "../src/job-store.ts";
import { requireRunDir } from "../src/layout.ts";
import { loadLatestModel, writeModelFiles } from "../src/model-io.ts";
import { writeHistory } from "../src/history.ts";
import { persistGeometryRepair } from "../src/repair.ts";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helpers = path.join(cliRoot, "test/helpers");
const emptyParser = path.join(helpers, "empty-parser.mjs");
const badParser = path.join(helpers, "bad-patch-parser.mjs");

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

const META = { provenance: "importer@0.1", basis: "assumed" as const };

function twoRooms(): FlatModel {
  return {
    schemaVersion: "0.1",
    id: "val-synth",
    revision: 1,
    source: { site: "manual", fetchedAt: "2026-09-12T10:00:00Z" },
    flat: {
      meta: { provenance: "importer@0.1", basis: "declared" },
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: {
          wallHeight: { ...META },
          doorHeight: { ...META },
          windowSill: { ...META },
          windowHeight: { ...META },
        },
      },
    },
    plan: { asset: null, meta: { ...META } },
    vertices: {
      v1: [0, 0],
      v2: [4, 0],
      v3: [8, 0],
      v4: [8, 3],
      v5: [4, 3],
      v6: [0, 3],
    },
    walls: {
      w12: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { ...META } },
      w23: { a: "v2", b: "v3", thickness: 0.2, exterior: true, meta: { ...META } },
      w34: { a: "v3", b: "v4", thickness: 0.2, exterior: true, meta: { ...META } },
      w45: { a: "v4", b: "v5", thickness: 0.2, exterior: true, meta: { ...META } },
      w56: { a: "v5", b: "v6", thickness: 0.2, exterior: true, meta: { ...META } },
      w61: { a: "v6", b: "v1", thickness: 0.2, exterior: true, meta: { ...META } },
      w25: { a: "v2", b: "v5", thickness: 0.2, exterior: false, meta: { ...META } },
    },
    openings: {
      d1: { wall: "w25", kind: "door", at: 0.8, width: 0.4, meta: { ...META } },
      d2: { wall: "w25", kind: "door", at: 1.4, width: 1, meta: { ...META } },
      enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
    },
    rooms: {
      left: { anchor: [2, 1.5], type: "living", label: "Left", meta: { ...META } },
      right: { anchor: [6, 1.5], type: "bedroom", label: "Right", meta: { ...META } },
    },
    assets: {},
  };
}

function grokQueue(contents: string[]): GeometryRepairClient {
  let i = 0;
  return {
    mode: "fixture",
    chatCompletions: async () => {
      const content = contents[i++];
      if (content === undefined) throw new Error("unexpected Grok call");
      return {
        synthetic: true,
        body: { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] },
      };
    },
  };
}

function jobEnv(extra: NodeJS.Dict<string> = {}): NodeJS.Dict<string> {
  return {
    ...process.env,
    FLATWALK_ADAPTERS: "",
    FLATWALK_PLAN_PARSER: emptyParser,
    XAI_API_KEY: "",
    FIRECRAWL_API_KEY: "",
    FAL_KEY: "",
    PARSER_URL: "",
    ...extra,
  };
}

describe("listing job (file store)", () => {
  it("completes a fixture job and agrees model/report/materials", async () => {
    const jobsRoot = await tmp("flatwalk-job-ok-");
    const view = await executeListingJob({
      jobsRoot,
      from: "fixtures/54541",
      adapters: "fixture",
      force: true,
      env: jobEnv(),
    });
    expect(view.job.status).toBe("succeeded");
    expect(view.job.stage).toBe("publish");
    expect(view.model?.id).toBe("cityexpert-54541");
    expect(view.model?.revision).toBeGreaterThan(0);
    expect(view.report?.modelId).toBe(view.model?.id);
    expect(view.report?.revision).toBe(view.model?.revision);
    expect(view.runs.find((run) => run.stage === "match")?.outcome).toBe("unavailable");
    expect(view.runs.find((run) => run.stage === "dress")?.outcome).toBe("unavailable");
    const plan = view.materials.find((item) => item.kind === "plan");
    expect(plan?.url).toMatch(/materials\/plan\.png$/);
    const planFile = path.join(view.job.runDir, plan!.url.replace(/^\//, ""));
    await expect(readFile(planFile)).resolves.toBeInstanceOf(Buffer);
    const latest = await loadLatestModel(view.job.runDir);
    expect(latest.revision).toBe(view.model?.revision);
    expect(view.history?.currentRevision).toBe(latest.revision);
    expect(view.history?.changes.length).toBeGreaterThan(0);
  }, 180_000);

  it("records provider failure without selecting synthetic geometry", async () => {
    const jobsRoot = await tmp("flatwalk-job-live-");
    const view = await executeListingJob({
      jobsRoot,
      from: "fixtures/54541",
      adapters: "live",
      force: true,
      env: jobEnv({ XAI_API_KEY: "" }),
    });
    expect(view.job.status).toBe("failed");
    expect(view.job.stage).toBe("parse");
    expect(view.model?.revision).toBe(0);
    expect(Object.keys(view.model?.vertices ?? {})).toHaveLength(0);
    expect(view.runs.find((run) => run.stage === "parse")?.outcome).toBe("failure");
    expect(JSON.stringify(view.runs)).not.toMatch(/synthetic grok-rects fixture/);
    expect(view.materials.some((item) => item.kind === "plan")).toBe(true);
    expect(view.materials.some((item) => item.kind === "photo")).toBe(true);
  }, 60_000);

  it("keeps rev 0 and materials when the parser patch is malformed", async () => {
    const jobsRoot = await tmp("flatwalk-job-bad-");
    const view = await executeListingJob({
      jobsRoot,
      from: "fixtures/54541",
      adapters: "fixture",
      force: true,
      env: jobEnv({ FLATWALK_PLAN_PARSER: badParser }),
    });
    expect(view.job.status).toBe("failed");
    expect(view.model?.revision).toBe(0);
    expect(view.runs.find((run) => run.stage === "parse")?.outcome).toBe("failure");
    expect(view.materials.length).toBeGreaterThan(1);
  }, 60_000);

  it("stores two repair snapshots in job history without re-applying result.patch", async () => {
    const jobsRoot = await tmp("flatwalk-job-repair-");
    const runDir = path.join(jobsRoot, "repair-case");
    await mkdir(runDir, { recursive: true });
    await requireRunDir(runDir);
    const model = twoRooms();
    model.openings.enter = { wall: "w61", kind: "door", at: 1, width: 1, meta: { ...META } };
    await writeModelFiles(runDir, model);
    await writeHistory(runDir, {
      schemaVersion: "0.1",
      modelId: model.id,
      baseRevision: 0,
      currentRevision: 1,
      changes: [{ revision: 1, touchedPaths: ["openings.d1"], touchedOwners: ["openings.d1"] }],
    });
    const grok = grokQueue([
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }] }),
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.enter.entrance", value: true }] }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
    await persistGeometryRepair(runDir, model, result);
    const latest = await loadLatestModel(runDir);
    expect(latest.revision).toBe(result.model.revision);
    expect(latest.revision).toBeGreaterThanOrEqual(3);
    const view = await ingestJobArtifacts({
      jobsRoot,
      jobId: "repair-case",
      runDir,
      adapters: "fixture",
      status: "succeeded",
      stage: "publish",
    });
    expect(view.history?.changes.map((change) => change.revision)).toEqual([1, 2, 3]);
    expect(view.model?.revision).toBe(3);
    const report = JSON.parse(
      await readFile(path.join(runDir, "validation/rev-003.json"), "utf8"),
    ) as ValidationReport;
    expect(report.modelId).toBe(view.model?.id);
    expect(report.revision).toBe(3);
    expect(result.patch?.baseRevision).toBe(2);
  });
});

describe("listing job HTTP", () => {
  it("submits a fixture job and resolves material URLs through the job API", async () => {
    const jobsRoot = await tmp("flatwalk-job-http-");
    const api: JobApi = { jobsRoot, env: jobEnv() };
    const server = createServer((req, res) => {
      void handleJobHttp(req, res, api);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no listen port");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const created = await fetch(`${origin}/api/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "fixtures/54541", adapters: "fixture" }),
      });
      expect(created.status).toBe(200);
      const body = (await created.json()) as { job: { id: string } };
      const jobId = body.job.id;
      let view: { job: { status: string } } = { job: { status: "queued" } };
      for (let i = 0; i < 180; i += 1) {
        const response = await fetch(`${origin}/api/jobs/${jobId}`);
        if (response.ok) {
          view = (await response.json()) as { job: { status: string } };
          if (view.job.status === "succeeded" || view.job.status === "failed") break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(view.job.status).toBe("succeeded");
      const snapshot = (await (await fetch(`${origin}/api/jobs/${jobId}`)).json()) as {
        materials: Array<{ kind: string; url: string }>;
        model: { assets: Record<string, { url: string }> };
        report: { modelId: string; revision: number };
        job: { modelId: string; revision: number };
      };
      expect(snapshot.report.revision).toBe(snapshot.job.revision);
      const plan = snapshot.materials.find((item) => item.kind === "plan");
      expect(plan?.url).toMatch(new RegExp(`/api/jobs/${jobId}/file/materials/plan\\.png$`));
      const material = await fetch(`${origin}${plan!.url}`);
      expect(material.status).toBe(200);
      expect(material.headers.get("content-type")).toMatch(/image\/png/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  }, 180_000);

  it("treats missing PARSER_URL on a live HTTP parse as unavailable, not synthetic geometry", async () => {
    const jobsRoot = await tmp("flatwalk-job-parser-url-");
    const view = await executeListingJob({
      jobsRoot,
      from: "fixtures/54541",
      adapters: "live",
      force: true,
      parser: "http",
      env: jobEnv({ PARSER_URL: "", XAI_API_KEY: "" }),
    });
    expect(view.job.status).toBe("failed");
    const parse = view.runs.find((run) => run.stage === "parse");
    expect(parse?.diagnostics.python).toMatchObject({ outcome: "unavailable" });
    expect(view.model?.revision).toBe(0);
  }, 60_000);
});

describe("HTTP plan parser helper", () => {
  it("POSTs after GET /health and records empty patch without calling grok here", async () => {
    const { runHttpParser } = await import("../src/python-parser.ts");
    const server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", contractSchemas: {} }));
        return;
      }
      if (req.url === "/parse") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ patch: null, reason: "opencv-no-geometry" }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no listen port");
    try {
      const outDir = await tmp("flatwalk-http-parser-");
      const planPath = path.join(cliRoot, "../../fixtures/54541/plan.png");
      const outcome = await runHttpParser({
        planPath,
        listingId: "54541",
        area: 105,
        outDir,
        parserUrl: `http://127.0.0.1:${address.port}`,
      });
      expect(outcome.unavailable).toBeFalsy();
      expect(outcome.result?.patch).toBeNull();
      expect(outcome.result?.reason).toBe("opencv-no-geometry");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

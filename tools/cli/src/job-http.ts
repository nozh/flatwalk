import { createReadStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { executeListingJob } from "./job.ts";
import { ingestJobArtifacts, readJobRecord, writeJobRecord, type JobView } from "./job-store.ts";
import type { AdapterMode } from "./adapters.ts";

export type JobApi = {
  jobsRoot: string;
  env?: NodeJS.Dict<string>;
};

const inflight = new Map<string, Promise<JobView>>();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(`${JSON.stringify(body)}\n`);
}

function notFound(res: ServerResponse, message: string): void {
  json(res, 404, { error: message });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function publicView(origin: string, view: JobView): JobView {
  const prefix = `/api/jobs/${view.job.id}/file/`;
  return {
    ...view,
    materials: view.materials.map((item) => ({
      ...item,
      url: /^(https?:|data:|blob:)/i.test(item.url) ? item.url : `${prefix}${item.url.replace(/^\/+/, "")}`,
    })),
    job: { ...view.job, runDir: view.job.runDir },
  };
}

async function loadView(jobsRoot: string, jobId: string): Promise<JobView | undefined> {
  const runDir = path.join(jobsRoot, jobId);
  const job = await readJobRecord(runDir);
  if (!job) return undefined;
  return ingestJobArtifacts({
    jobsRoot,
    jobId,
    runDir,
    adapters: job.adapters,
    status: job.status,
    stage: job.stage,
    error: job.error,
    listingUrl: job.listingUrl,
    from: job.from,
  });
}

function mimeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream";
}

function safeFile(runDir: string, rel: string): string | undefined {
  const cleaned = decodeURIComponent(rel).replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0") || cleaned.includes("..")) return undefined;
  const resolved = path.resolve(runDir, cleaned);
  if (!resolved.startsWith(path.resolve(runDir) + path.sep) && resolved !== path.resolve(runDir)) return undefined;
  return resolved;
}

export async function handleJobHttp(req: IncomingMessage, res: ServerResponse, api: JobApi): Promise<void> {
  const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
  const url = new URL(req.url ?? "/", origin);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs") {
    let body: { from?: string; url?: string; adapters?: AdapterMode };
    try {
      body = (await readBody(req)) as { from?: string; url?: string; adapters?: AdapterMode };
    } catch {
      json(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const adapters: AdapterMode = body.adapters === "live" ? "live" : "fixture";
    if (!body.from && !body.url) {
      json(res, 400, { error: "from or url is required" });
      return;
    }
    if (body.url && adapters !== "live") {
      json(res, 400, { error: "url requires adapters: live" });
      return;
    }
    const jobId = crypto.randomUUID();
    const runDir = path.join(api.jobsRoot, jobId);
    await mkdir(runDir, { recursive: true });
    const queuedAt = Date.now();
    await writeJobRecord({
      id: jobId,
      status: "queued",
      stage: "import",
      adapters,
      listingUrl: body.url,
      from: body.from,
      runDir,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    });
    const pending = executeListingJob({
      jobsRoot: api.jobsRoot,
      jobId,
      runDir,
      from: body.from,
      url: body.url,
      adapters,
      force: true,
      env: api.env,
    });
    inflight.set(jobId, pending);
    void pending.finally(() => inflight.delete(jobId));
    json(res, 200, { job: { id: jobId, status: "queued", stage: "import" } });
    return;
  }

  const fileMatch = /^\/api\/jobs\/([^/]+)\/file\/(.+)$/.exec(url.pathname);
  if (req.method === "GET" && fileMatch) {
    const jobId = fileMatch[1]!;
    const rel = fileMatch[2]!;
    const runDir = path.join(api.jobsRoot, jobId);
    const file = safeFile(runDir, rel);
    if (!file) {
      notFound(res, "Invalid path");
      return;
    }
    try {
      await access(file);
    } catch {
      notFound(res, "File not found");
      return;
    }
    res.writeHead(200, {
      "content-type": mimeFor(file),
      "access-control-allow-origin": "*",
    });
    createReadStream(file).pipe(res);
    return;
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(url.pathname);
  if (req.method === "GET" && jobMatch) {
    const jobId = jobMatch[1]!;
    const view = await loadView(api.jobsRoot, jobId);
    if (!view) {
      notFound(res, `Unknown job ${jobId}`);
      return;
    }
    json(res, 200, publicView(origin, view));
    return;
  }

  json(res, 404, { error: "Not found" });
}

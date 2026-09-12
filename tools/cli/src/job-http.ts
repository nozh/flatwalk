import { createReadStream } from "node:fs";
import { access, mkdir, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { AdapterMode } from "./adapters.ts";
import { executeListingJob } from "./job.ts";
import {
  ingestJobArtifacts,
  readJobRecord,
  writeJobRecord,
  type JobRecord,
  type JobView,
  type MaterialRef,
} from "./job-store.ts";
import { RUN_SUBDIRS } from "./paths.ts";

export type JobApi = {
  jobsRoot: string;
  env?: NodeJS.Dict<string>;
};

const inflight = new Map<string, Promise<JobView>>();
const posted = new Map<string, JobRecord>();
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ROOTS = new Set<string>(RUN_SUBDIRS);

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

function badRequest(res: ServerResponse, message: string): void {
  json(res, 400, { error: message });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

function asJobPostBody(raw: unknown): { from?: string; url?: string; adapters?: AdapterMode } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("JSON object body is required");
  }
  const body = raw as Record<string, unknown>;
  const from = body.from;
  const url = body.url;
  const adapters = body.adapters;
  if (from !== undefined && typeof from !== "string") throw new TypeError("from must be a string");
  if (url !== undefined && typeof url !== "string") throw new TypeError("url must be a string");
  if (adapters !== undefined && adapters !== "live" && adapters !== "fixture") {
    throw new TypeError("adapters must be fixture or live");
  }
  return { from, url, adapters };
}

function publicListing(listing: JobView["listing"]): Record<string, unknown> | undefined {
  if (!listing) return undefined;
  const assets = Object.fromEntries(
    Object.entries(listing.assets ?? {}).map(([id, asset]) => {
      const { localPath: _localPath, ...rest } = asset;
      return [id, rest];
    }),
  );
  return { ...listing, assets };
}

function publicMaterials(jobId: string, materials: MaterialRef[]): Array<Omit<MaterialRef, "localPath">> {
  const prefix = `/api/jobs/${jobId}/file/`;
  return materials.map((item) => {
    const { localPath: _localPath, ...rest } = item;
    const url = /^(https?:|data:|blob:)/i.test(item.url) ? item.url : `${prefix}${item.url.replace(/^\/+/, "")}`;
    return { ...rest, url };
  });
}

function publicView(view: JobView): Record<string, unknown> {
  const { runDir: _runDir, ...job } = view.job;
  return {
    ...view,
    listing: publicListing(view.listing),
    materials: publicMaterials(view.job.id, view.materials),
    job,
  };
}

function parseJobUrl(req: IncomingMessage): URL {
  const origin = `http://${req.headers.host ?? "127.0.0.1"}`;
  return new URL(req.url ?? "/", origin);
}

function fullyDecode(rel: string): string {
  let current = rel;
  for (let i = 0; i < 4; i += 1) {
    const next = decodeURIComponent(current);
    if (next === current) return current;
    current = next;
  }
  throw new URIError("Over-encoded path");
}

function lexicalJobFile(runDir: string, rel: string): string | undefined {
  const cleaned = fullyDecode(rel).replace(/^\/+/, "").replaceAll("\\", "/");
  if (!cleaned || cleaned.includes("\0")) return undefined;
  const segments = cleaned.split("/").filter((part) => part.length > 0);
  if (segments.length < 2) return undefined;
  if (segments.some((part) => part === "." || part === ".." || part.startsWith("."))) return undefined;
  if (!ALLOWED_ROOTS.has(segments[0]!)) return undefined;
  const resolved = path.resolve(runDir, ...segments);
  const root = path.resolve(runDir);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return resolved;
}

async function resolveJobFile(runDir: string, rel: string): Promise<string | undefined> {
  const candidate = lexicalJobFile(runDir, rel);
  if (!candidate) return undefined;
  try {
    const [rootReal, fileReal] = await Promise.all([realpath(runDir), realpath(candidate)]);
    const relative = path.relative(rootReal, fileReal);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    const top = relative.split(path.sep)[0];
    if (!top || !ALLOWED_ROOTS.has(top)) return undefined;
    return fileReal;
  } catch {
    return undefined;
  }
}

function queuedView(record: JobRecord): JobView {
  return { job: record, runs: [], materials: [] };
}

async function loadView(jobsRoot: string, jobId: string): Promise<JobView | undefined> {
  const runDir = path.join(jobsRoot, jobId);
  const job = await readJobRecord(runDir);
  if (job) {
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
  const snapshot = posted.get(jobId);
  if (snapshot) return queuedView(snapshot);
  return undefined;
}

function mimeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".webp")) return "image/webp";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".glb")) return "model/gltf-binary";
  return "application/octet-stream";
}

async function dispatchJobHttp(req: IncomingMessage, res: ServerResponse, api: JobApi): Promise<void> {
  const url = parseJobUrl(req);
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
    let raw: unknown;
    try {
      raw = await readBody(req);
    } catch {
      badRequest(res, "Invalid JSON body");
      return;
    }
    let body: { from?: string; url?: string; adapters?: AdapterMode };
    try {
      body = asJobPostBody(raw);
    } catch (error) {
      badRequest(res, error instanceof Error ? error.message : "Invalid JSON body");
      return;
    }
    const adapters: AdapterMode = body.adapters === "live" ? "live" : "fixture";
    if (!body.from && !body.url) {
      badRequest(res, "from or url is required");
      return;
    }
    if (body.url && adapters !== "live") {
      badRequest(res, "url requires adapters: live");
      return;
    }
    const jobId = crypto.randomUUID();
    const runDir = path.join(api.jobsRoot, jobId);
    await mkdir(runDir, { recursive: true });
    const queuedAt = Date.now();
    const record: JobRecord = {
      id: jobId,
      status: "queued",
      stage: "import",
      adapters,
      listingUrl: body.url,
      from: body.from,
      runDir,
      createdAt: queuedAt,
      updatedAt: queuedAt,
    };
    await writeJobRecord(record);
    posted.set(jobId, record);
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
    void pending.finally(() => {
      inflight.delete(jobId);
      posted.delete(jobId);
    });
    json(res, 200, { job: { id: jobId, status: "queued", stage: "import" } });
    return;
  }

  const fileMatch = /^\/api\/jobs\/([^/]+)\/file\/(.+)$/.exec(url.pathname);
  if (req.method === "GET" && fileMatch) {
    const jobId = fileMatch[1]!;
    const rel = fileMatch[2]!;
    if (!JOB_ID_RE.test(jobId)) {
      notFound(res, "Invalid path");
      return;
    }
    const runDir = path.join(api.jobsRoot, jobId);
    let file: string | undefined;
    try {
      file = await resolveJobFile(runDir, rel);
    } catch (error) {
      if (error instanceof URIError) {
        badRequest(res, "Invalid path encoding");
        return;
      }
      throw error;
    }
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
    if (!JOB_ID_RE.test(jobId)) {
      notFound(res, `Unknown job ${jobId}`);
      return;
    }
    const view = await loadView(api.jobsRoot, jobId);
    if (!view) {
      notFound(res, `Unknown job ${jobId}`);
      return;
    }
    json(res, 200, publicView(view));
    return;
  }

  json(res, 404, { error: "Not found" });
}

export async function handleJobHttp(req: IncomingMessage, res: ServerResponse, api: JobApi): Promise<void> {
  try {
    await dispatchJobHttp(req, res, api);
  } catch (error) {
    if (res.headersSent) return;
    if (error instanceof URIError || error instanceof SyntaxError || error instanceof TypeError) {
      badRequest(res, error instanceof Error ? error.message : "Invalid request");
      return;
    }
    json(res, 400, { error: "Invalid request" });
  }
}

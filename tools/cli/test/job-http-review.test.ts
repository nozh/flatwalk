import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { handleJobHttp, type JobApi } from "../src/job-http.ts";
import { prepareRunDir } from "../src/layout.ts";
import { writeJobRecord } from "../src/job-store.ts";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emptyParser = path.join(cliRoot, "test/helpers/empty-parser.mjs");

async function tmp(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function jobEnv(): NodeJS.Dict<string> {
  return {
    ...process.env,
    FLATWALK_ADAPTERS: "",
    FLATWALK_PLAN_PARSER: emptyParser,
    XAI_API_KEY: "",
    FIRECRAWL_API_KEY: "",
    FAL_KEY: "",
    PARSER_URL: "",
  };
}

async function listen(api: JobApi): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    void handleJobHttp(req, res, api).catch((error: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no listen port");
  return { origin: `http://127.0.0.1:${address.port}`, server };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe("local job API review regressions", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    while (servers.length) {
      const server = servers.pop();
      if (server) await closeServer(server);
    }
  });

  it("refuses dotfiles, traversal encodings, and symlink escape from the job file endpoint", async () => {
    const jobsRoot = await tmp("flatwalk-job-file-");
    const jobId = "11111111-1111-4111-8111-111111111111";
    const runDir = path.join(jobsRoot, jobId);
    const outside = path.join(await tmp("flatwalk-job-outside-"), "secret.txt");
    await writeFile(outside, "HOST-SECRET\n");
    await mkdir(path.join(runDir, "materials"), { recursive: true });
    await writeFile(path.join(runDir, ".env"), "XAI_API_KEY=should-not-leak\n");
    await writeFile(path.join(runDir, "materials", "plan.png"), "PLAN");
    await symlink(outside, path.join(runDir, "materials", "escape.txt"));
    const { origin, server } = await listen({ jobsRoot, env: jobEnv() });
    servers.push(server);

    const allowed = await fetch(`${origin}/api/jobs/${jobId}/file/materials/plan.png`);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("PLAN");

    const probes = [
      `${origin}/api/jobs/${jobId}/file/.env`,
      `${origin}/api/jobs/${jobId}/file/%2eenv`,
      `${origin}/api/jobs/${jobId}/file/materials/escape.txt`,
      `${origin}/api/jobs/${jobId}/file/materials/%2e%2e/.env`,
      `${origin}/api/jobs/${jobId}/file/materials/..%2f..%2f.git/config`,
    ];
    for (const url of probes) {
      const response = await fetch(url);
      expect(response.status, url).toBeGreaterThanOrEqual(400);
      expect(response.status, url).toBeLessThan(500);
      const body = await response.text();
      expect(body).not.toMatch(/should-not-leak|HOST-SECRET/);
    }
  });

  it("returns HTTP 4xx for null/array/scalar JSON and malformed percent encoding", async () => {
    const jobsRoot = await tmp("flatwalk-job-json-");
    const { origin, server } = await listen({ jobsRoot, env: jobEnv() });
    servers.push(server);
    const jobId = "22222222-2222-4222-8222-222222222222";
    await mkdir(path.join(jobsRoot, jobId, "materials"), { recursive: true });

    const payloads = ["null", "[]", "1", '"scalar"'];
    for (const body of payloads) {
      const response = await fetch(`${origin}/api/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      expect(response.status, body).toBeGreaterThanOrEqual(400);
      expect(response.status, body).toBeLessThan(500);
      expect(response.headers.get("content-type")).toMatch(/json/);
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    }

    const malformed = await fetch(`${origin}/api/jobs/${jobId}/file/materials/%E0%A4%A`);
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(malformed.status).toBeLessThan(500);
    expect(malformed.headers.get("content-type")).toMatch(/json/);
    await expect(malformed.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("never 404s queued/running job.json between POST and the first polls", async () => {
    const jobsRoot = await tmp("flatwalk-job-poll-");
    const { origin, server } = await listen({ jobsRoot, env: jobEnv() });
    servers.push(server);
    const created = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "fixtures/54541", adapters: "fixture" }),
    });
    expect(created.status).toBe(200);
    const posted = (await created.json()) as { job: { id: string } };
    const statuses: number[] = [];
    let last: { job?: { status?: string } } = {};
    for (let i = 0; i < 40; i += 1) {
      const response = await fetch(`${origin}/api/jobs/${posted.job.id}`);
      statuses.push(response.status);
      if (response.ok) last = (await response.json()) as { job?: { status?: string } };
      else await response.text();
    }
    expect(statuses.every((status) => status !== 404)).toBe(true);
    expect(statuses[0]).toBe(200);
    expect(["queued", "running", "succeeded", "failed"]).toContain(last.job?.status);
    const jobJson = await readFile(path.join(jobsRoot, posted.job.id, "job.json"), "utf8");
    expect(jobJson.length).toBeGreaterThan(2);
  }, 180_000);

  it("omits host runDir and localPath from the public job JSON", async () => {
    const jobsRoot = await tmp("flatwalk-job-paths-");
    const jobId = "33333333-3333-4333-8333-333333333333";
    const runDir = path.join(jobsRoot, jobId);
    await mkdir(path.join(runDir, "materials"), { recursive: true });
    await writeJobRecord({
      id: jobId,
      status: "failed",
      stage: "parse",
      adapters: "live",
      runDir,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await writeFile(
      path.join(runDir, "materials", "listing.json"),
      `${JSON.stringify({
        source: { site: "manual", url: "https://example.test/listing", fetchedAt: "2026-09-12T10:00:00Z", listingId: "x" },
        assets: {
          "plan-01": {
            id: "plan-01",
            kind: "plan",
            sourceUrl: "https://example.test/plan.png",
            localPath: path.join(runDir, "materials", "plan.png"),
            bytes: 4,
          },
        },
      })}\n`,
    );
    await writeFile(path.join(runDir, "materials", "plan.png"), "PLAN");
    const { origin, server } = await listen({ jobsRoot, env: jobEnv() });
    servers.push(server);
    const response = await fetch(`${origin}/api/jobs/${jobId}`);
    expect(response.status).toBe(200);
    const payload = JSON.stringify(await response.json());
    expect(payload).not.toContain(runDir);
    expect(payload).not.toContain(jobsRoot);
    expect(payload).not.toMatch(/"localPath"\s*:/);
    expect(payload).not.toMatch(/"runDir"\s*:/);
  });

  it("keeps two concurrent jobs isolated by id, directory, and material URLs", async () => {
    const jobsRoot = await tmp("flatwalk-job-parallel-");
    const { origin, server } = await listen({ jobsRoot, env: jobEnv() });
    servers.push(server);
    const [a, b] = await Promise.all([
      fetch(`${origin}/api/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "fixtures/54541", adapters: "fixture" }),
      }),
      fetch(`${origin}/api/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "fixtures/54541", adapters: "fixture" }),
      }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const idA = ((await a.json()) as { job: { id: string } }).job.id;
    const idB = ((await b.json()) as { job: { id: string } }).job.id;
    expect(idA).not.toBe(idB);

    const poll = async (id: string) => {
      const seen: number[] = [];
      let body: {
        job: { id: string; status: string };
        materials: Array<{ url: string }>;
      } | undefined;
      for (let i = 0; i < 180; i += 1) {
        const response = await fetch(`${origin}/api/jobs/${id}`);
        seen.push(response.status);
        expect(response.status).not.toBe(404);
        if (response.ok) {
          body = (await response.json()) as typeof body;
          if (body?.job.status === "succeeded" || body?.job.status === "failed") break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(seen.every((status) => status !== 404)).toBe(true);
      expect(body?.job.status).toBe("succeeded");
      expect(body?.job.id).toBe(id);
      const plan = body?.materials.find((item) => item.url.includes("plan.png"));
      expect(plan?.url).toContain(`/api/jobs/${id}/file/`);
      expect(plan?.url).not.toContain(`/api/jobs/${id === idA ? idB : idA}/file/`);
      return body!;
    };

    const [viewA, viewB] = await Promise.all([poll(idA), poll(idB)]);
    expect(viewA.job.id).not.toBe(viewB.job.id);
    const otherPlan = path.join(jobsRoot, idB, "materials", "plan.png");
    const stolen = await fetch(
      `${origin}/api/jobs/${idA}/file/materials/${encodeURIComponent(`../${idB}/materials/plan.png`)}`,
    );
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    await expect(readFile(otherPlan)).resolves.toBeInstanceOf(Buffer);
  }, 180_000);

  it("preserves queued job.json when prepareRunDir force-replaces the run folder", async () => {
    const runDir = await tmp("flatwalk-job-prepare-");
    await writeFile(path.join(runDir, "job.json"), `${JSON.stringify({ id: "keep", status: "queued" })}\n`);
    await mkdir(path.join(runDir, "materials"), { recursive: true });
    await writeFile(path.join(runDir, "materials", "stale.txt"), "old");
    await prepareRunDir(runDir, true);
    const kept = JSON.parse(await readFile(path.join(runDir, "job.json"), "utf8")) as { status: string };
    expect(kept.status).toBe("queued");
    await expect(readFile(path.join(runDir, "materials", "stale.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.ts";
import { liveVarPresent } from "../src/adapters.ts";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(cliRoot, "src/index.ts");
const helpers = path.join(cliRoot, "test/helpers");

function runCli(
  args: string[],
  extraEnv: NodeJS.Dict<string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      cwd: cliRoot,
      env: { ...process.env, FLATWALK_ADAPTERS: "", NODE_NO_WARNINGS: "1", ...extraEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

describe("parseArgs run", () => {
  it("parses the no-seed pipeline", () => {
    const parsed = parseArgs(["node", "flatwalk", "run", "runs/54541", "--from", "fixtures/54541"]);
    expect(parsed.command).toBe("run");
    expect(parsed.seed).toBeUndefined();
    expect(parsed.from).toBe("fixtures/54541");
  });
});

describe("live readiness names", () => {
  it("detects presence without exposing values", () => {
    expect(liveVarPresent({ XAI_API_KEY: "secret" }, "XAI_API_KEY")).toBe(true);
    expect(liveVarPresent({ XAI_API_KEY: "  " }, "XAI_API_KEY")).toBe(false);
    expect(liveVarPresent({}, "XAI_API_KEY")).toBe(false);
  });
});

describe("CLI fixture parse without --seed", () => {
  it("falls back from empty Python to grok-rects fixture and publishes a revision", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-parse-"));
    const emptyParser = path.join(helpers, "empty-parser.mjs");
    try {
      const imported = await runCli(["import", runDir, "--from", "fixtures/54541"]);
      expect(imported.stderr, imported.stderr).toBe("");
      expect(imported.code).toBe(0);
      expect(imported.stdout).toMatch(/empty geometry/);
      expect(imported.stdout).not.toMatch(/seeded/);

      const parsed = await runCli(["parse", runDir], { FLATWALK_PLAN_PARSER: emptyParser });
      expect(parsed.code, parsed.stderr + parsed.stdout).toBe(0);
      expect(parsed.stdout).toMatch(/Python empty\/error\/timeout → grok-rects/);
      expect(parsed.stdout).toMatch(/synthetic grok-rects fixture, not recognition/);
      expect(parsed.stdout).not.toMatch(/live grok-rects API was called/);

      const latest = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8")) as {
        id: string;
        revision: number;
      };
      expect(latest.id).toBe("cityexpert-54541");
      expect(latest.revision).toBeGreaterThan(0);

      const history = JSON.parse(await readFile(path.join(runDir, "model/history.json"), "utf8")) as {
        modelId: string;
        currentRevision: number;
        changes: unknown[];
      };
      expect(history.modelId).toBe(latest.id);
      expect(history.currentRevision).toBe(latest.revision);
      expect(history.changes.length).toBe(1);

      const diagnostics = JSON.parse(await readFile(path.join(runDir, "parser/diagnostics.json"), "utf8")) as {
        fallback?: string;
        publishedRevision?: number;
      };
      expect(diagnostics.fallback).toMatch(/patch: null|not-implemented/);
      expect(diagnostics.publishedRevision).toBe(latest.revision);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("times out Python after FLATWALK_PARSER_TIMEOUT_MS and still uses grok-rects", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-timeout-"));
    const timeoutParser = path.join(helpers, "timeout-parser.mjs");
    try {
      expect((await runCli(["import", runDir, "--from", "fixtures/54541"])).code).toBe(0);
      const parsed = await runCli(["parse", runDir], {
        FLATWALK_PLAN_PARSER: timeoutParser,
        FLATWALK_PARSER_TIMEOUT_MS: "400",
      });
      expect(parsed.code, parsed.stderr + parsed.stdout).toBe(0);
      expect(parsed.stdout).toMatch(/timed out after 400 ms/);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }, 30_000);

  it("refuses a parser patch that is not a Contract Patch and keeps rev 0", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-badpatch-"));
    const badParser = path.join(helpers, "bad-patch-parser.mjs");
    try {
      expect((await runCli(["import", runDir, "--from", "fixtures/54541"])).code).toBe(0);
      const parsed = await runCli(["parse", runDir], { FLATWALK_PLAN_PARSER: badParser });
      expect(parsed.code).toBe(3);
      expect(parsed.stderr).toMatch(/not a Contract Patch|Resolver did not accept/);
      const latest = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8")) as {
        revision: number;
      };
      expect(latest.revision).toBe(0);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("CLI run without --seed", () => {
  it("imports, parses via fixture fallback, validates, skips repair, builds, and prints Viewer", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-run-"));
    const emptyParser = path.join(helpers, "empty-parser.mjs");
    try {
      const ran = await runCli(["run", runDir, "--from", "fixtures/54541"], {
        FLATWALK_PLAN_PARSER: emptyParser,
      });
      expect(ran.code, ran.stderr + ran.stdout).toBe(0);
      expect(ran.stdout).toMatch(/── import/);
      expect(ran.stdout).toMatch(/── parse/);
      expect(ran.stdout).toMatch(/proposeRepair/);
      expect(ran.stdout).toMatch(/walkReady with clearance=skipped is not proof of physical walkability/);
      expect(ran.stdout).toMatch(/open http:\/\/127\.0\.0\.1:5173\//);
      expect(ran.stdout).toMatch(/match: не реализовано/);
      expect(ran.stdout).toMatch(/dress: не реализовано/);
      expect(ran.stdout).toMatch(/Builder GLB/);
      expect(ran.stdout).not.toMatch(/manual fixture, not recognition/);

      const glb = await readFile(path.join(runDir, "build/flat.glb"));
      expect(glb.subarray(0, 4).toString()).toBe("glTF");
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("CLI live adapters without keys", () => {
  it("does not fall back to fixture when XAI_API_KEY is missing", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-live-missing-"));
    const emptyParser = path.join(helpers, "empty-parser.mjs");
    try {
      expect((await runCli(["import", runDir, "--from", "fixtures/54541"])).code).toBe(0);
      const parsed = await runCli(["parse", runDir, "--adapters", "live"], {
        FLATWALK_PLAN_PARSER: emptyParser,
        XAI_API_KEY: "",
      });
      expect(parsed.code).toBe(4);
      expect(parsed.stderr).toMatch(/XAI_API_KEY is missing/);
      expect(parsed.stdout).not.toMatch(/synthetic grok-rects fixture/);
      const latest = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8")) as {
        revision: number;
      };
      expect(latest.revision).toBe(0);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  }, 60_000);
});

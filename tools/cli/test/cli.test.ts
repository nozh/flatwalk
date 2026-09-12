import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.ts";
import { repoRoot } from "../src/paths.ts";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(cliRoot, "src/index.ts");

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const helpers = path.join(cliRoot, "test/helpers");

function runCli(
  args: string[],
  cwd = cliRoot,
  extraEnv: NodeJS.Dict<string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      cwd,
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

describe("parseArgs", () => {
  it("parses the documented seed import", () => {
    const parsed = parseArgs(["node", "flatwalk", "import", "runs/54541", "--from", "fixtures/54541", "--seed"]);
    expect(parsed.command).toBe("import");
    expect(parsed.runDir).toBe("runs/54541");
    expect(parsed.from).toBe("fixtures/54541");
    expect(parsed.seed).toBe(true);
  });
});

describe("CLI 54541 fixture path", () => {
  it("seeds the fixture, builds snapshot+GLB, refuses invalid models, and does not mutate the fixture", async () => {
    const fixtureModel = path.join(repoRoot(), "fixtures/54541/flat.model.json");
    const before = sha256(await readFile(fixtureModel));
    const runDir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-"));

    try {
      const imported = await runCli(["import", runDir, "--from", "fixtures/54541", "--seed"]);
      expect(imported.stderr, imported.stderr).toBe("");
      expect(imported.code).toBe(0);
      expect(imported.stdout).toMatch(/seeded cityexpert-54541/);
      expect(imported.stdout).toMatch(/manual fixture, not recognition/);

      const latest = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8")) as {
        id: string;
        revision: number;
      };
      expect(latest.id).toBe("cityexpert-54541");
      expect(latest.revision).toBe(0);

      const again = await runCli(["import", runDir, "--from", "fixtures/54541", "--seed"]);
      expect(again.code).toBe(2);
      expect(again.stderr).toMatch(/already exists/);

      const validated = await runCli(["validate", runDir]);
      expect(validated.code).toBe(0);
      expect(validated.stdout).toMatch(/validation\/rev-000\.json/);
      expect(validated.stdout).toMatch(/Связность комнат проверена\. Ширина проходов не проверена/);
      expect(validated.stdout).toMatch(/не полная готовность прогулки/);
      expect(validated.stdout).toMatch(/proposeRepair/);
      const report = JSON.parse(await readFile(path.join(runDir, "validation/rev-000.json"), "utf8")) as {
        schemaVersion: string;
        modelId: string;
        revision: number;
        walkReady: boolean;
        checks: Array<{ checkId: string; status: string }>;
      };
      expect(report.schemaVersion).toBe("0.1");
      expect(report.modelId).toBe("cityexpert-54541");
      expect(report.revision).toBe(0);
      expect(report.walkReady).toBe(true);
      expect(report.checks.find((check) => check.checkId === "navigation.clearance")?.status).toBe("skipped");

      const matched = await runCli(["match", runDir]);
      expect(matched.code).toBe(0);
      expect(matched.stdout).toMatch(/match: не реализовано/);

      const dressed = await runCli(["dress", runDir]);
      expect(dressed.code).toBe(0);
      expect(dressed.stdout).toMatch(/dress: не реализовано/);

      const built = await runCli(["build", runDir]);
      expect(built.stderr, built.stderr).toBe("");
      expect(built.code).toBe(0);
      expect(built.stdout).toMatch(/Builder snapshot/);
      expect(built.stdout).toMatch(/Builder GLB/);

      const snap = JSON.parse(await readFile(path.join(runDir, "build/scene.snapshot.json"), "utf8")) as unknown[];
      expect(snap.length).toBeGreaterThan(10);
      const glb = await readFile(path.join(runDir, "build/flat.glb"));
      expect(glb.subarray(0, 4).toString()).toBe("glTF");

      const served = await runCli(["serve", runDir, "--print-cmd"]);
      expect(served.code).toBe(0);
      expect(served.stdout).toMatch(/open http:\/\/127\.0\.0\.1:5173\//);
      expect(served.stdout).toMatch(/FLATWALK_RUN=/);

      const missing = await runCli(["build", path.join(os.tmpdir(), `flatwalk-cli-absent-${Date.now()}`)]);
      expect(missing.code).toBe(2);
      expect(missing.stderr).toMatch(/Run directory not found/);

      const emptyRun = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-empty-"));
      await runCli(["import", emptyRun, "--from", "fixtures/54541", "--seed"]);
      await rm(path.join(emptyRun, "model/latest.json"));
      const noModel = await runCli(["build", emptyRun]);
      expect(noModel.code).toBe(3);
      expect(noModel.stderr).toMatch(/No model/);

      await writeFile(path.join(emptyRun, "model/latest.json"), '{"schemaVersion":"0.1"}\n');
      const invalid = await runCli(["build", emptyRun]);
      expect(invalid.code).toBe(3);
      expect(invalid.stderr).toMatch(/Public Contract rejected/);
      await rm(emptyRun, { recursive: true, force: true });

      const liveFallback = await runCli(["import", path.join(runDir, "nope"), "--from", "fixtures/missing-listing"]);
      expect(liveFallback.code).toBe(4);
      expect(liveFallback.stderr).toMatch(/Live mode is not used as a fallback/);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }

    expect(sha256(await readFile(fixtureModel))).toBe(before);
  }, 120_000);
});

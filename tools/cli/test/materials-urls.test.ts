import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.ts";
import { runFolderMaterialUrl } from "../src/import.ts";
import { repoRoot } from "../src/paths.ts";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(cliRoot, "src/index.ts");

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      cwd: cliRoot,
      env: { ...process.env, FLATWALK_ADAPTERS: "", NODE_NO_WARNINGS: "1" },
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

/** Same rule as Viewer static `resolveAssetUrl` in modules/viewer/src/source.ts. */
function viewerStaticUrl(url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url) || url.startsWith("/")) return url;
  return `/${url.replace(/^\.\//, "")}`.replace(/\/{2,}/g, "/");
}

async function assertCopiedMaterialUrls(runDir: string): Promise<number> {
  const model = JSON.parse(await readFile(path.join(runDir, "model/latest.json"), "utf8")) as {
    assets: Record<string, { url: string }>;
  };
  const urls = Object.values(model.assets).map((asset) => asset.url);
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url.startsWith("materials/"), url).toBe(true);
    expect(viewerStaticUrl(url).startsWith("/materials/"), viewerStaticUrl(url)).toBe(true);
    await access(path.join(runDir, url));
  }
  return urls.length;
}

describe("runFolderMaterialUrl", () => {
  it("prefixes materials/ for Viewer static resolution from the run folder", () => {
    expect(runFolderMaterialUrl("plan.png")).toBe("materials/plan.png");
    expect(runFolderMaterialUrl("photos/photo-04.jpg")).toBe("materials/photos/photo-04.jpg");
    expect(runFolderMaterialUrl("materials/plan.png")).toBe("materials/plan.png");
    expect(viewerStaticUrl(runFolderMaterialUrl("plan.png"))).toBe("/materials/plan.png");
  });
});

describe("INT-B01 material URLs", () => {
  it("rewrites seed and bundleToModel asset URLs onto copied files", async () => {
    const fixtureModel = path.join(repoRoot(), "fixtures/54541/flat.model.json");
    const seedUrls = Object.values(
      (JSON.parse(await readFile(fixtureModel, "utf8")) as { assets: Record<string, { url: string }> }).assets,
    ).map((asset) => asset.url);
    expect(seedUrls.some((url) => url === "plan.png" || url.startsWith("photos/"))).toBe(true);

    const seeded = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-seed-urls-"));
    const parsed = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-bundle-urls-"));
    try {
      const seedImport = await runCli(["import", seeded, "--from", "fixtures/54541", "--seed"]);
      expect(seedImport.stderr, seedImport.stderr).toBe("");
      expect(seedImport.code).toBe(0);
      const seedCount = await assertCopiedMaterialUrls(seeded);
      expect(seedCount).toBe(seedUrls.length);

      const bundleImport = await runCli(["import", parsed, "--from", "fixtures/54541"]);
      expect(bundleImport.stderr, bundleImport.stderr).toBe("");
      expect(bundleImport.code).toBe(0);
      expect(bundleImport.stdout).toMatch(/empty geometry/);
      const bundleCount = await assertCopiedMaterialUrls(parsed);
      expect(bundleCount).toBe(seedCount);

      const seedAfter = JSON.parse(await readFile(fixtureModel, "utf8")) as { assets: Record<string, { url: string }> };
      expect(seedAfter.assets.plan.url).toBe("plan.png");
    } finally {
      await rm(seeded, { recursive: true, force: true });
      await rm(parsed, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("parseArgs INT-B01 helpers stay independent", () => {
  it("still parses import without seed", () => {
    const parsed = parseArgs(["node", "flatwalk", "import", "runs/54541", "--from", "fixtures/54541"]);
    expect(parsed.seed).toBeUndefined();
  });
});

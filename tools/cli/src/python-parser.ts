import { spawn } from "node:child_process";
import path from "node:path";

export const PARSER_TIMEOUT_MS = 60_000;

export type PythonParserOutcome = {
  timeout: boolean;
  error?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  result?: { patch: unknown | null; reason?: string };
};

export function parserTimeoutMs(env: NodeJS.Dict<string> = process.env): number {
  const raw = env.FLATWALK_PARSER_TIMEOUT_MS;
  if (raw === undefined || raw === "") return PARSER_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : PARSER_TIMEOUT_MS;
}

function parserArgv(
  planPath: string,
  listingId: string,
  area: number | undefined,
  outDir: string,
  env: NodeJS.Dict<string>,
  repoRoot: string,
): { command: string; args: string[]; cwd: string; extraEnv?: NodeJS.Dict<string> } {
  const rest = ["parse", planPath, "--listing-id", listingId, "--out", outDir];
  if (area !== undefined) rest.splice(4, 0, "--area", String(area));
  const override = env.FLATWALK_PLAN_PARSER;
  if (override) {
    return { command: process.execPath, args: [override, ...rest], cwd: repoRoot };
  }
  return {
    command: "uv",
    args: ["run", "python", "-m", "plan_parser", ...rest],
    cwd: path.join(repoRoot, "services/plan-parser"),
    extraEnv: { PYTHONUNBUFFERED: "1" },
  };
}

function parseResultJson(stdout: string): { patch: unknown | null; reason?: string } | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { patch?: unknown; reason?: string };
    if (parsed && typeof parsed === "object" && "patch" in parsed) {
      return { patch: parsed.patch ?? null, reason: typeof parsed.reason === "string" ? parsed.reason : undefined };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function runPythonParser(options: {
  planPath: string;
  listingId: string;
  area?: number;
  outDir: string;
  repoRoot: string;
  env?: NodeJS.Dict<string>;
}): Promise<PythonParserOutcome> {
  const env = options.env ?? process.env;
  const timeoutMs = parserTimeoutMs(env);
  const invocation = parserArgv(
    options.planPath,
    options.listingId,
    options.area,
    options.outDir,
    env,
    options.repoRoot,
  );

  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.extraEnv, ...env },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ timeout: true, error: `plan-parser timed out after ${timeoutMs} ms`, exitCode: null, stdout, stderr });
    }, timeoutMs);

    const finish = (outcome: PythonParserOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      finish({
        timeout: false,
        error: error.message,
        exitCode: null,
        stdout,
        stderr,
      });
    });
    child.on("close", (code) => {
      if (settled) {
        finish({ timeout: true, error: `plan-parser timed out after ${timeoutMs} ms`, exitCode: code, stdout, stderr });
        return;
      }
      const result = parseResultJson(stdout);
      if (code !== 0) {
        finish({
          timeout: false,
          error: stderr.trim() || `plan-parser exited with code ${code}`,
          exitCode: code,
          stdout,
          stderr,
          result,
        });
        return;
      }
      if (!result) {
        finish({
          timeout: false,
          error: "plan-parser returned no JSON { patch, reason }",
          exitCode: code,
          stdout,
          stderr,
        });
        return;
      }
      finish({ timeout: false, exitCode: code, stdout, stderr, result });
    });
  });
}

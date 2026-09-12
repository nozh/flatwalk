import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { CliError, EXIT } from "./errors.ts";
import { handleJobHttp } from "./job-http.ts";
import { repoRoot } from "./paths.ts";

export const VIEWER_DEV_URL = "http://127.0.0.1:5173/";
export const JOB_API_PORT = 8787;

export function viewerDevCommand(runDir: string, jobApiUrl = `http://127.0.0.1:${JOB_API_PORT}`): {
  cwd: string;
  runDir: string;
  url: string;
  shell: string;
} {
  const abs = path.resolve(runDir);
  const cwd = path.join(repoRoot(), "modules/viewer");
  return {
    cwd,
    runDir: abs,
    url: VIEWER_DEV_URL,
    shell: `VITE_JOB_API_URL=${jobApiUrl} FLATWALK_RUN=${abs} npm run dev`,
  };
}

export function printViewerOpen(runDir: string): void {
  const port = Number(process.env.FLATWALK_JOB_API_PORT ?? JOB_API_PORT);
  const cmd = viewerDevCommand(runDir, `http://127.0.0.1:${port}`);
  console.log(`serve: Viewer static reads model/, materials/, validation/ from ${cmd.runDir}`);
  console.log(`serve: ${cmd.shell}`);
  console.log(`serve: cwd ${cmd.cwd}`);
  console.log(`serve: open ${cmd.url}`);
}

export function startJobApiServer(jobsRoot: string, env: NodeJS.Dict<string> = process.env): Server {
  const port = Number(env.FLATWALK_JOB_API_PORT ?? JOB_API_PORT);
  const server = createServer((req, res) => {
    void handleJobHttp(req, res, { jobsRoot, env });
  });
  server.listen(port, "127.0.0.1");
  console.log(`serve: job API http://127.0.0.1:${port}/api/jobs (submit URL or fixture; not the prepared demo)`);
  console.log("serve: Open prepared demo remains Viewer ?src=fixture — a separate labelled fallback");
  return server;
}

export async function runServe(runDir: string, options: { start: boolean }): Promise<void> {
  const abs = path.resolve(runDir);
  await mkdir(abs, { recursive: true });
  const port = Number(process.env.FLATWALK_JOB_API_PORT ?? JOB_API_PORT);
  const jobApiUrl = `http://127.0.0.1:${port}`;
  printViewerOpen(abs);
  console.log(`serve: local form uses ${jobApiUrl}; public Render must not point at this host`);
  if (!options.start) {
    console.log("serve: Viewer not started from this command. Start with: serve <dir> (omit --print-cmd).");
    console.log(`serve: ${viewerDevCommand(abs, jobApiUrl).shell}`);
    return;
  }

  const jobsRoot = process.env.FLATWALK_JOBS_ROOT ?? abs;
  await mkdir(jobsRoot, { recursive: true });
  const jobServer = startJobApiServer(path.resolve(jobsRoot));
  if (process.env.FLATWALK_JOBS_ONLY === "1") {
    console.log("serve: job API only (Viewer is not started from this process)");
    await new Promise<void>(() => {});
    return;
  }

  const cmd = viewerDevCommand(abs, jobApiUrl);
  try {
    await access(path.join(cmd.cwd, "package.json"));
  } catch {
    jobServer.close();
    throw new CliError(
      EXIT.io,
      `Viewer package not found at ${cmd.cwd}. Install it separately; CLI does not rewrite Viewer.`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "dev"], {
      cwd: cmd.cwd,
      env: { ...process.env, FLATWALK_RUN: cmd.runDir, VITE_JOB_API_URL: jobApiUrl },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      jobServer.close();
      reject(
        new CliError(
          EXIT.io,
          `Failed to start Viewer: ${error.message}. Use the printed command in modules/viewer.`,
        ),
      );
    });
    child.on("close", (code) => {
      jobServer.close();
      if (code === 0 || code === null) resolve();
      else reject(new CliError(EXIT.io, `Viewer exited with code ${code}`));
    });
  });
}

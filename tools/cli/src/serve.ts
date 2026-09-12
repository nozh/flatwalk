import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { CliError, EXIT } from "./errors.ts";
import { requireRunDir } from "./layout.ts";
import { repoRoot } from "./paths.ts";

export const VIEWER_DEV_URL = "http://127.0.0.1:5173/";

export function viewerDevCommand(runDir: string): {
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
    shell: `FLATWALK_RUN=${abs} npm run dev`,
  };
}

export function printViewerOpen(runDir: string): void {
  const cmd = viewerDevCommand(runDir);
  console.log(`serve: Viewer static reads model/, materials/, validation/ from ${cmd.runDir}`);
  console.log(`serve: ${cmd.shell}`);
  console.log(`serve: cwd ${cmd.cwd}`);
  console.log(`serve: open ${cmd.url}`);
}

export async function runServe(runDir: string, options: { start: boolean }): Promise<void> {
  const paths = await requireRunDir(runDir);
  printViewerOpen(paths.root);
  if (!options.start) {
    console.log("serve: Viewer not started from this command. Start with: serve <dir> (omit --print-cmd).");
    return;
  }

  const cmd = viewerDevCommand(paths.root);
  try {
    await access(path.join(cmd.cwd, "package.json"));
  } catch {
    throw new CliError(
      EXIT.io,
      `Viewer package not found at ${cmd.cwd}. Install it separately; CLI does not rewrite Viewer.`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["run", "dev"], {
      cwd: cmd.cwd,
      env: { ...process.env, FLATWALK_RUN: cmd.runDir },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      reject(
        new CliError(
          EXIT.io,
          `Failed to start Viewer: ${error.message}. Use the printed command in modules/viewer.`,
        ),
      );
    });
    child.on("close", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new CliError(EXIT.io, `Viewer exited with code ${code}`));
    });
  });
}

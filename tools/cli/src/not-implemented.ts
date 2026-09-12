import { requireRunDir } from "./layout.ts";

export async function runNotImplemented(stage: string, runDir: string, detail: string): Promise<void> {
  await requireRunDir(runDir);
  console.log(`${stage}: не реализовано (${detail}). Папка запуска не выдаётся за результат этого этапа.`);
}

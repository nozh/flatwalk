export function stage(name: string, detail?: string): void {
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`\n── ${name}${suffix} ──`);
}

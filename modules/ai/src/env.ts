import { readFile } from "node:fs/promises";

/**
 * Parse a gitignored dotenv file. Values are never logged by this helper.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Apply only keys that are unset or empty. Returns names of keys assigned, never values. */
export function applyParsedEnv(
  parsed: Record<string, string>,
  env: NodeJS.Dict<string> = process.env,
): string[] {
  const assigned: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined || env[key] === "") {
      env[key] = value;
      assigned.push(key);
    }
  }
  return assigned;
}

export async function loadEnvFiles(
  paths: string[],
  env: NodeJS.Dict<string> = process.env,
): Promise<{ filesRead: string[]; keysAssigned: string[] }> {
  const filesRead: string[] = [];
  const keysAssigned: string[] = [];
  for (const filePath of paths) {
    let contents: string;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }
    filesRead.push(filePath);
    for (const key of applyParsedEnv(parseEnvFile(contents), env)) {
      if (!keysAssigned.includes(key)) keysAssigned.push(key);
    }
  }
  return { filesRead, keysAssigned };
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/^(authorization|apiKey|api_key)$/i.test(key) || /secret|password|bearer/i.test(key)) {
        out[key] = nested == null || nested === "" ? nested : "[redacted]";
      } else {
        out[key] = redactSecrets(nested);
      }
    }
    return out;
  }
  return value;
}

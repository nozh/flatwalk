import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterError } from "./errors.js";

export type FixtureEnvelope<T> = {
  synthetic: boolean;
  note?: string;
  body: T;
};

export function defaultFixtureDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
}

export function fixturePath(fixtureDir: string, fixtureId: string): string {
  const relative = fixtureId.endsWith(".json") ? fixtureId : `${fixtureId}.json`;
  return path.resolve(fixtureDir, relative);
}

export async function readFixtureEnvelope<T>(
  fixtureDir: string,
  fixtureId: string,
): Promise<FixtureEnvelope<T>> {
  const filePath = fixturePath(fixtureDir, fixtureId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AdapterError(
        "missing-fixture",
        `Fixture file is missing: ${path.basename(filePath)} (${filePath}). Fixture mode does not call the network.`,
      );
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new AdapterError("invalid-response", `Fixture ${filePath} is not valid JSON`, {
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== "object" || !("body" in parsed)) {
    throw new AdapterError(
      "invalid-response",
      `Fixture ${path.basename(filePath)} must be an envelope with a body field`,
    );
  }

  const envelope = parsed as { synthetic?: unknown; note?: unknown; body: T };
  const synthetic = envelope.synthetic === true;
  return {
    synthetic,
    note: typeof envelope.note === "string" ? envelope.note : undefined,
    body: envelope.body,
  };
}

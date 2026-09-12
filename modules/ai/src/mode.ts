import { AdapterError } from "./errors.js";

export type AdapterMode = "fixture" | "live";

export function resolveAdapterMode(
  env: NodeJS.Dict<string> = process.env,
): AdapterMode {
  const raw = env.FLATWALK_ADAPTERS;
  if (raw === undefined || raw === "") {
    return "fixture";
  }
  if (raw === "fixture" || raw === "live") {
    return raw;
  }
  throw new AdapterError(
    "invalid-mode",
    `FLATWALK_ADAPTERS must be "fixture" or "live", got ${JSON.stringify(raw)}`,
  );
}

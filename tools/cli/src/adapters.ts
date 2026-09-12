import { loadFirecrawlEnv } from "@flatwalk/firecrawl";
import { CliError, EXIT } from "./errors.ts";

export type AdapterMode = "fixture" | "live";

export function resolveAdapterMode(options: {
  flag?: AdapterMode;
  env?: NodeJS.Dict<string>;
}): AdapterMode {
  if (options.flag) return options.flag;
  const raw = options.env?.FLATWALK_ADAPTERS;
  if (raw === undefined || raw === "") return "fixture";
  if (raw === "fixture" || raw === "live") return raw;
  throw new CliError(
    EXIT.adapters,
    `FLATWALK_ADAPTERS must be "fixture" or "live", got ${JSON.stringify(raw)}`,
  );
}

export function requireLiveMode(mode: AdapterMode, action: string): void {
  if (mode === "live") return;
  throw new CliError(
    EXIT.adapters,
    `${action} requires --adapters live (or FLATWALK_ADAPTERS=live). Fixture mode does not call external APIs.`,
  );
}

export function refuseSilentLive(reason: string): never {
  throw new CliError(
    EXIT.adapters,
    `${reason} Live mode is not used as a fallback.`,
  );
}

const LIVE_VARS = ["XAI_API_KEY", "FIRECRAWL_API_KEY", "FAL_KEY", "PARSER_URL"] as const;

export function liveVarPresent(env: NodeJS.Dict<string>, name: (typeof LIVE_VARS)[number]): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "";
}

/** Names only — never print values. */
export function printLiveReadiness(mode: AdapterMode, env: NodeJS.Dict<string> = process.env): void {
  if (mode !== "live") {
    console.log("adapters: live APIs will not be called (fixture is the default)");
    return;
  }
  loadFirecrawlEnv();
  const missing = LIVE_VARS.filter((name) => !liveVarPresent(env, name));
  const present = LIVE_VARS.filter((name) => liveVarPresent(env, name));
  if (present.length > 0) console.log(`adapters: live variables present (names only): ${present.join(", ")}`);
  if (missing.length > 0) {
    console.log(
      `adapters: live variables missing: ${missing.join(", ")}. Fixture output is not a live result.`,
    );
  }
}

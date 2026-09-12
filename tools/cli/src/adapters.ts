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

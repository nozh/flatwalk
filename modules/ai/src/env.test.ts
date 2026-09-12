import { describe, expect, it } from "vitest";
import { applyParsedEnv, parseEnvFile, redactSecrets } from "./env.js";

describe("gitignored env loader", () => {
  it("parses keys without requiring comments or quoted empty values", () => {
    const parsed = parseEnvFile(`
# comment
XAI_API_KEY=not-a-real-key
FLATWALK_ADAPTERS=live
EMPTY=
QUOTED="value"
`);
    expect(parsed.XAI_API_KEY).toBe("not-a-real-key");
    expect(parsed.FLATWALK_ADAPTERS).toBe("live");
    expect(parsed.QUOTED).toBe("value");
    expect(parsed.EMPTY).toBe("");
  });

  it("does not overwrite a key that is already set", () => {
    const env: NodeJS.Dict<string> = { XAI_API_KEY: "from-process" };
    const assigned = applyParsedEnv({ XAI_API_KEY: "from-file", OTHER: "yes" }, env);
    expect(env.XAI_API_KEY).toBe("from-process");
    expect(env.OTHER).toBe("yes");
    expect(assigned).toEqual(["OTHER"]);
  });

  it("redacts credential fields and leaves request metadata", () => {
    expect(
      redactSecrets({
        authorization: "Bearer secret-must-not-appear",
        apiKey: "secret-must-not-appear",
        model: "grok-4.6",
        xaiApiKey: "present",
      }),
    ).toEqual({
      authorization: "[redacted]",
      apiKey: "[redacted]",
      model: "grok-4.6",
      xaiApiKey: "present",
    });
  });
});

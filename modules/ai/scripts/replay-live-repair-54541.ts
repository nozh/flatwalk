/**
 * Replay the live geometry-repair ops from the first 54541 Grok call.
 * Does not call x.ai. Local wrap adds required Meta, then Resolver/validate.
 *
 *   RUN=/tmp/flatwalk-54541-live-repair node --import tsx modules/ai/scripts/replay-live-repair-54541.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runGeometryRepair, type GeometryRepairClient } from "../src/geometry-repair.ts";
import { persistGeometryRepair } from "../../../tools/cli/src/repair.ts";
import { loadLatestModel } from "../../../tools/cli/src/model-io.ts";

const runDir = process.env.RUN;
if (!runDir) {
  throw new Error("RUN must be the CLI run directory that already has the remapped live grok-rects model");
}

const repairLog = JSON.parse(await readFile(path.join(runDir, "parser/geometry-repair.json"), "utf8")) as {
  diagnostics?: { liveApiCalled?: boolean };
  attempts: Array<{
    rejected?: Array<{ path: string; value: unknown; reason: string }>;
  }>;
};

const rejected = repairLog.attempts[0]?.rejected ?? [];
if (!repairLog.diagnostics?.liveApiCalled || rejected.length === 0) {
  throw new Error("Expected a live geometry-repair attempt with rejected ops to replay");
}

const ops = rejected.map((item) => ({ op: "set" as const, path: item.path, value: item.value }));
const grok: GeometryRepairClient = {
  mode: "fixture",
  chatCompletions: async () => ({
    synthetic: false,
    note: "Replay of live geometry-repair attempt 1 ops. Meta filled locally. Not a second x.ai call.",
    body: {
      choices: [
        {
          message: { role: "assistant", content: JSON.stringify({ refuse: null, ops }) },
          finish_reason: "stop",
        },
      ],
    },
  }),
};

const model = await loadLatestModel(runDir);
const result = await runGeometryRepair({ model, grok });
const persist = await persistGeometryRepair(runDir, model, result);
console.log(
  JSON.stringify(
    {
      stopped: result.stopped,
      persist,
      liveApiCalled: result.diagnostics.liveApiCalled,
      note: result.diagnostics.note,
      id: result.model.id,
      revision: result.model.revision,
      walkReady: result.attempts.at(-1)?.nextReport?.walkReady ?? null,
      rejected: result.attempts[0]?.apply?.rejected ?? [],
    },
    null,
    2,
  ),
);

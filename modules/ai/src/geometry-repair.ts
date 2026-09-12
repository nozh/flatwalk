import { PatchSchema, type FlatModel, type Op, type Patch, type ValidationReport } from "@flatwalk/contract";
import { apply, type ApplyResult } from "@flatwalk/resolver";
import { validate, type AvatarProfile } from "@flatwalk/validator";
import { AdapterError } from "./errors.js";
import { createGrokClient, type GrokChatRequest, type GrokChatResult } from "./grok.js";
import { connectivityForRepair, fictitiousInteriorDoor } from "./geometry-repair-connectivity.js";
import { geometryRepairPrompt } from "./geometry-repair-prompt.js";
import {
  GEOMETRY_REPAIR_FIXTURE_ID,
  GEOMETRY_REPAIR_MAX_ATTEMPTS,
  GEOMETRY_REPAIR_MODULE,
  GEOMETRY_REPAIR_PROMPT_VERSION,
  geometryRepairFixtureId,
  parseGeometryRepairJson,
  rewriteAutomaticProvenance,
  stripRaisedConfidence,
} from "./geometry-repair-schema.js";

/** Call-level only. Does not change DEFAULT_GROK_TIMEOUT_MS used by Matcher. */
export const GEOMETRY_REPAIR_TIMEOUT_MS = 180_000;
export const GEOMETRY_REPAIR_CHAT_EXTRA = {
  reasoning_effort: "low",
  max_completion_tokens: 4096,
  response_format: { type: "json_object" },
} as const;

export {
  GEOMETRY_REPAIR_FIXTURE_ID,
  GEOMETRY_REPAIR_MAX_ATTEMPTS,
  GEOMETRY_REPAIR_MODULE,
  GEOMETRY_REPAIR_PROMPT_VERSION,
  geometryRepairFixtureId,
  geometryRepairResultSchema,
  parseGeometryRepairJson,
  parseGeometryRepairResult,
} from "./geometry-repair-schema.js";
export { geometryRepairPrompt } from "./geometry-repair-prompt.js";

const GEOM_LAYERS = new Set(["geometry", "consistency", "navigation"]);

export type GeometryRepairClient = {
  mode: "fixture" | "live";
  chatCompletions: (request: GrokChatRequest) => Promise<GrokChatResult>;
};

export type GeometryRepairStopReason =
  | "no-geometry-errors"
  | "repaired"
  | "refused"
  | "invalid-patch"
  | "no-progress"
  | "same-result"
  | "attempts-exhausted"
  | "resolver-rejected"
  | "missing-fixture"
  | "missing-config"
  | "adapter-error";

export type GeometryRepairAttempt = {
  attempt: number;
  baseRevision: number;
  report: ValidationReport;
  fixtureId: string;
  grokText?: string;
  patch: Patch | null;
  reason?: string;
  /** Resolver snapshot for this step. Orchestrator must persist this, not re-apply `result.patch`. */
  model?: FlatModel;
  apply?: Pick<ApplyResult, "applied" | "rejected" | "touchedPaths" | "touchedOwners"> & {
    revision: number;
  };
  nextReport?: ValidationReport;
};

export type GeometryRepairDiagnostics = {
  module: typeof GEOMETRY_REPAIR_MODULE;
  promptVersion: typeof GEOMETRY_REPAIR_PROMPT_VERSION;
  fixtureId: string;
  synthetic?: boolean;
  liveApiCalled: boolean;
  note?: string;
  schemaErrors?: string[];
};

export type GeometryRepairOutput = {
  model: FlatModel;
  patch: Patch | null;
  stopped: GeometryRepairStopReason;
  attempts: GeometryRepairAttempt[];
  diagnostics: GeometryRepairDiagnostics;
};

export type GeometryRepairPlan = {
  imageUrl?: string;
  imageBase64?: string;
};

export type GeometryRepairInput = {
  model: FlatModel;
  report?: ValidationReport;
  grok?: GeometryRepairClient;
  fixtureId?: string;
  avatar?: AvatarProfile;
  plan?: GeometryRepairPlan;
};

function planImageUrl(plan?: GeometryRepairPlan): string | undefined {
  if (plan?.imageUrl && (plan.imageUrl.startsWith("data:") || plan.imageUrl.startsWith("http"))) {
    return plan.imageUrl;
  }
  if (plan?.imageBase64) {
    return plan.imageBase64.startsWith("data:")
      ? plan.imageBase64
      : `data:image/png;base64,${plan.imageBase64}`;
  }
  return undefined;
}

function repairMessages(
  prompt: { system: string; user: string },
  plan?: GeometryRepairPlan,
): GrokChatRequest["messages"] {
  const imageUrl = planImageUrl(plan);
  const userContent = imageUrl
    ? [
        { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
        { type: "text", text: prompt.user },
      ]
    : prompt.user;
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: userContent },
  ];
}

function failingGeometry(report: ValidationReport) {
  return report.checks.filter((check) => check.status === "fail" && GEOM_LAYERS.has(check.layer));
}

function failKey(report: ValidationReport): string {
  return failingGeometry(report)
    .map((check) => check.checkId)
    .sort()
    .join("|");
}

function compactGeometry(model: FlatModel) {
  return {
    vertices: model.vertices,
    walls: Object.fromEntries(
      Object.entries(model.walls).map(([id, wall]) => [
        id,
        { a: wall.a, b: wall.b, thickness: wall.thickness, exterior: wall.exterior },
      ]),
    ),
    openings: Object.fromEntries(
      Object.entries(model.openings).map(([id, opening]) => [
        id,
        {
          wall: opening.wall,
          kind: opening.kind,
          at: opening.at,
          width: opening.width,
          entrance: opening.kind === "door" ? opening.entrance : undefined,
          passable: opening.kind === "door" ? opening.passable : undefined,
        },
      ]),
    ),
    rooms: Object.fromEntries(
      Object.entries(model.rooms).map(([id, room]) => [id, { anchor: room.anchor, type: room.type, label: room.label }]),
    ),
  };
}

function currentContext(model: FlatModel) {
  return {
    schemaVersion: "0.1" as const,
    modelId: model.id,
    baseRevision: model.revision,
    currentRevision: model.revision,
    changes: [],
  };
}

function asPatch(model: FlatModel, ops: Op[]): Patch | null {
  const patch: Patch = {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: model.revision,
    module: GEOMETRY_REPAIR_MODULE,
    ops,
  };
  const parsed = PatchSchema.safeParse(patch);
  return parsed.success ? parsed.data : null;
}

function done(
  model: FlatModel,
  patch: Patch | null,
  stopped: GeometryRepairStopReason,
  attempts: GeometryRepairAttempt[],
  diagnostics: Partial<GeometryRepairDiagnostics> = {},
): GeometryRepairOutput {
  return {
    model,
    patch,
    stopped,
    attempts,
    diagnostics: {
      module: GEOMETRY_REPAIR_MODULE,
      promptVersion: GEOMETRY_REPAIR_PROMPT_VERSION,
      fixtureId: GEOMETRY_REPAIR_FIXTURE_ID,
      liveApiCalled: false,
      ...diagnostics,
    },
  };
}

export async function runGeometryRepair(input: GeometryRepairInput): Promise<GeometryRepairOutput> {
  if (!input?.model) {
    throw new TypeError("runGeometryRepair requires an explicit accepted FlatModel");
  }

  const grok = input.grok ?? createGrokClient();
  const fixtureBase = input.fixtureId ?? GEOMETRY_REPAIR_FIXTURE_ID;
  const attempts: GeometryRepairAttempt[] = [];
  let current = input.model;
  let lastAcceptedPatch: Patch | null = null;
  let report =
    input.report && input.report.modelId === current.id && input.report.revision === current.revision
      ? input.report
      : validate(current, input.avatar);
  let previousFailKey: string | undefined;
  let synthetic: boolean | undefined;
  let liveApiCalled = false;
  let adapterNote: string | undefined;

  if (failingGeometry(report).length === 0) {
    return done(current, null, "no-geometry-errors", attempts, { fixtureId: fixtureBase });
  }

  for (let attempt = 1; attempt <= GEOMETRY_REPAIR_MAX_ATTEMPTS; attempt += 1) {
    const fixtureId = geometryRepairFixtureId(fixtureBase, attempt);
    const prompt = geometryRepairPrompt({
      modelId: current.id,
      revision: current.revision,
      failingChecks: failingGeometry(report).map((check) => ({
        checkId: check.checkId,
        layer: check.layer,
        message: check.message,
        entities: check.entities,
      })),
      geometry: compactGeometry(current),
      connectivity: (() => {
        try {
          return connectivityForRepair(current, report);
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      })(),
    });

    let chat: GrokChatResult;
    try {
      chat = await grok.chatCompletions({
        fixtureId,
        timeoutMs: GEOMETRY_REPAIR_TIMEOUT_MS,
        extra: { ...GEOMETRY_REPAIR_CHAT_EXTRA },
        messages: repairMessages(prompt, input.plan),
      });
    } catch (error) {
      const code = error instanceof AdapterError ? error.code : "adapter-error";
      const stopped: GeometryRepairStopReason =
        code === "missing-config" || code === "missing-fixture" ? code : "adapter-error";
      const note = error instanceof Error ? error.message : String(error);
      attempts.push({
        attempt,
        baseRevision: current.revision,
        report,
        fixtureId,
        reason: note,
        patch: null,
      });
      return done(current, lastAcceptedPatch, stopped, attempts, {
        fixtureId,
        note,
        liveApiCalled: false,
      });
    }

    synthetic = chat.synthetic;
    liveApiCalled = grok.mode === "live" && chat.synthetic !== true;
    adapterNote = chat.note;
    const grokText = chat.body.choices[0]?.message.content ?? undefined;

    const step: GeometryRepairAttempt = {
      attempt,
      baseRevision: current.revision,
      report,
      fixtureId,
      grokText: typeof grokText === "string" ? grokText : undefined,
      patch: null,
    };

    if (typeof grokText !== "string" || !grokText.trim()) {
      step.reason = "empty-completion";
      attempts.push(step);
      if (attempt === GEOMETRY_REPAIR_MAX_ATTEMPTS) {
        return done(current, lastAcceptedPatch, "invalid-patch", attempts, {
          fixtureId,
          synthetic,
          liveApiCalled,
          note: adapterNote,
          schemaErrors: ["Grok completion has no text content"],
        });
      }
      continue;
    }

    const parsed = parseGeometryRepairJson(grokText);
    if (!parsed.ok) {
      step.reason = parsed.errors[0];
      attempts.push(step);
      if (attempt === GEOMETRY_REPAIR_MAX_ATTEMPTS) {
        return done(current, lastAcceptedPatch, "invalid-patch", attempts, {
          fixtureId,
          synthetic,
          liveApiCalled,
          note: adapterNote,
          schemaErrors: parsed.errors,
        });
      }
      continue;
    }

    if (parsed.value.refuse) {
      step.reason = parsed.value.refuse;
      attempts.push(step);
      return done(current, lastAcceptedPatch, "refused", attempts, {
        fixtureId,
        synthetic,
        liveApiCalled,
        note: adapterNote,
      });
    }

    if (parsed.value.ops.length === 0) {
      step.reason = "empty-ops";
      attempts.push(step);
      return done(current, lastAcceptedPatch, "refused", attempts, {
        fixtureId,
        synthetic,
        liveApiCalled,
        note: adapterNote,
      });
    }

    const ops = rewriteAutomaticProvenance(stripRaisedConfidence(parsed.value.ops, current));
    const patch = asPatch(current, ops);
    if (!patch || patch.ops.length === 0) {
      step.reason = "invalid-contract-patch";
      attempts.push(step);
      if (attempt === GEOMETRY_REPAIR_MAX_ATTEMPTS) {
        return done(current, lastAcceptedPatch, "invalid-patch", attempts, {
          fixtureId,
          synthetic,
          liveApiCalled,
          note: adapterNote,
        });
      }
      continue;
    }

    step.patch = patch;
    const applied = apply(current, patch, currentContext(current));
    step.apply = {
      applied: applied.applied,
      rejected: applied.rejected,
      revision: applied.model.revision,
      touchedPaths: applied.touchedPaths,
      touchedOwners: applied.touchedOwners,
    };
    if (applied.model.revision !== current.revision) {
      try {
        const fake = fictitiousInteriorDoor(current, applied.model);
        if (fake) {
          step.reason = `fictitious-door: ${fake} is not on a shared interior wall ≥ 0.8 m`;
          attempts.push(step);
          if (attempt === GEOMETRY_REPAIR_MAX_ATTEMPTS) {
            return done(current, lastAcceptedPatch, "invalid-patch", attempts, {
              fixtureId,
              synthetic,
              liveApiCalled,
              note: adapterNote,
            });
          }
          continue;
        }
      } catch (error) {
        step.reason = error instanceof Error ? error.message : "fictitious-door-check-failed";
        attempts.push(step);
        if (attempt === GEOMETRY_REPAIR_MAX_ATTEMPTS) {
          return done(current, lastAcceptedPatch, "invalid-patch", attempts, {
            fixtureId,
            synthetic,
            liveApiCalled,
            note: adapterNote,
          });
        }
        continue;
      }
      step.model = applied.model;
    }

    const unchanged = applied.model === current || applied.model.revision === current.revision;
    if (unchanged && applied.applied.length === 0) {
      step.reason = applied.rejected.some((item) => item.reason === "human")
        ? "resolver-rejected-human"
        : "resolver-rejected";
      attempts.push(step);
      const stopped: GeometryRepairStopReason = applied.rejected.some((item) => item.reason === "human")
        ? "resolver-rejected"
        : "no-progress";
      return done(current, lastAcceptedPatch, stopped, attempts, {
        fixtureId,
        synthetic,
        liveApiCalled,
        note: adapterNote,
      });
    }

    const next = applied.model;
    const nextReport = validate(next, input.avatar);
    step.nextReport = nextReport;
    attempts.push(step);
    lastAcceptedPatch = patch;
    current = next;

    if (nextReport.walkReady) {
      return done(current, lastAcceptedPatch, "repaired", attempts, {
        fixtureId,
        synthetic,
        liveApiCalled,
        note: adapterNote,
      });
    }

    const nextKey = failKey(nextReport);
    const beforeKey = failKey(report);
    if (nextKey === beforeKey) {
      return done(current, lastAcceptedPatch, "no-progress", attempts, {
        fixtureId,
        synthetic,
        liveApiCalled,
        note: adapterNote,
      });
    }
    if (previousFailKey !== undefined && nextKey === previousFailKey) {
      return done(current, lastAcceptedPatch, "same-result", attempts, {
        fixtureId,
        synthetic,
        liveApiCalled,
        note: adapterNote,
      });
    }

    previousFailKey = beforeKey;
    report = nextReport;
  }

  return done(current, lastAcceptedPatch, "attempts-exhausted", attempts, {
    fixtureId: geometryRepairFixtureId(fixtureBase, GEOMETRY_REPAIR_MAX_ATTEMPTS),
    synthetic,
    liveApiCalled,
    note: adapterNote,
  });
}

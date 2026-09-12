import { OpSchema, type FlatModel, type Op } from "@flatwalk/contract";

export const GEOMETRY_REPAIR_MODULE = "geometry-repair/grok@0.1";
export const GEOMETRY_REPAIR_PROMPT_VERSION = "0.1";
export const GEOMETRY_REPAIR_MAX_ATTEMPTS = 2;
export const GEOMETRY_REPAIR_FIXTURE_ID = "grok/geometry-repair";

export type GeometryRepairOp = Op;

export type GeometryRepairProposal = {
  refuse: string | null;
  ops: GeometryRepairOp[];
};

export type ParseGeometryRepairResult =
  | { ok: true; value: GeometryRepairProposal }
  | { ok: false; errors: string[] };

const ALLOWED_ROOTS = new Set(["vertices", "walls", "openings", "rooms", "plan", "flat"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export function parseGeometryRepairJson(content: string): ParseGeometryRepairResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(content));
  } catch (error) {
    return {
      ok: false,
      errors: [`Response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return parseGeometryRepairResult(parsed);
}

export function parseGeometryRepairResult(input: unknown): ParseGeometryRepairResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["GeometryRepair proposal must be an object"] };
  }
  if ("schemaVersion" in input || "vertices" in input || "revision" in input) {
    errors.push("Payload looks like FlatModel; geometry-repair expects { refuse, ops }");
  }
  const extra = Object.keys(input).filter((key) => !["refuse", "ops"].includes(key));
  if (extra.length) errors.push(`Unexpected keys: ${extra.join(", ")}`);

  let refuse: string | null = null;
  if (input.refuse === undefined || input.refuse === null) {
    refuse = null;
  } else if (typeof input.refuse === "string" && input.refuse.trim()) {
    refuse = input.refuse.trim();
  } else if (typeof input.refuse === "string") {
    refuse = null;
  } else {
    errors.push("refuse must be a string or null");
  }

  const ops: GeometryRepairOp[] = [];
  if (input.ops === undefined) {
    if (!refuse) errors.push("ops must be an array when refuse is empty");
  } else if (!Array.isArray(input.ops)) {
    errors.push("ops must be an array");
  } else {
    input.ops.forEach((raw, index) => {
      const parsed = OpSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push(`ops[${index}] is not a Contract Op`);
        return;
      }
      const root = parsed.data.path.split(".")[0];
      if (!root || !ALLOWED_ROOTS.has(root)) {
        errors.push(`ops[${index}] path ${parsed.data.path} is outside the geometry-repair allowlist`);
        return;
      }
      ops.push(parsed.data);
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { refuse, ops } };
}

export function geometryRepairFixtureId(base: string, attempt: number): string {
  return `${base}.${attempt}`;
}

export const geometryRepairResultSchema = {
  $id: "flatwalk.geometry-repair.result",
  title: "GeometryRepairProposal",
  type: "object",
  additionalProperties: false,
  required: ["ops"],
  properties: {
    refuse: { type: ["string", "null"] },
    ops: {
      type: "array",
      items: {
        type: "object",
        required: ["op", "path"],
      },
    },
  },
} as const;

export function stripRaisedConfidence(ops: Op[], model: FlatModel): Op[] {
  const next: Op[] = [];
  for (const op of ops) {
    if (/(^|\.)confidence$/.test(op.path)) continue;
    if (op.op === "unset") {
      next.push(op);
      continue;
    }
    next.push({
      op: "set",
      path: op.path,
      value: stripConfidenceValue(op.value, currentAt(model, op.path)) as Extract<Op, { op: "set" }>["value"],
    });
  }
  return next;
}

function currentAt(model: FlatModel, path: string): unknown {
  let current: unknown = model;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

function stripConfidenceValue(value: unknown, previous: unknown): unknown {
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "confidence") {
      const prevConf = isRecord(previous) && typeof previous.confidence === "number" ? previous.confidence : undefined;
      if (typeof child === "number" && prevConf !== undefined) {
        next.confidence = Math.min(child, prevConf);
      }
      continue;
    }
    next[key] = stripConfidenceValue(child, isRecord(previous) ? previous[key] : undefined);
  }
  return next;
}

export function rewriteAutomaticProvenance(ops: Op[]): Op[] {
  return ops.map((op) => {
    if (op.op !== "set" || !isRecord(op.value)) return op;
    return {
      op: "set" as const,
      path: op.path,
      value: rewriteProvenance(op.value) as Extract<Op, { op: "set" }>["value"],
    };
  });
}

function rewriteProvenance(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "provenance" && child === "human") {
      next.provenance = GEOMETRY_REPAIR_MODULE;
      continue;
    }
    if (isRecord(child)) {
      next[key] = rewriteProvenance(child);
      continue;
    }
    next[key] = child;
  }
  return next;
}

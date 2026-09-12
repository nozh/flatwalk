import { PatchSchema, type FlatModel, type Op, type Patch } from "@flatwalk/contract";
import { GeometryError, adjacency, faces, roomPolygon } from "@flatwalk/geometry";
import { createGrokClient, DEFAULT_GROK_MODEL, type GrokChatRequest, type GrokChatResult } from "./grok.js";
import { grokRectsPrompt } from "./grok-rects-prompt.js";
import {
  assumedPlanMeta,
  graphRoomToContract,
  rectsToGraph,
  snapBoundaryNote,
  type RectGraph,
} from "./grok-rects-graph.js";
import {
  GROK_RECTS_CONFIDENCE,
  GROK_RECTS_FIXTURE_ID,
  GROK_RECTS_MODULE,
  GROK_RECTS_PROMPT_VERSION,
  parseGrokRectsJson,
} from "./grok-rects-schema.js";

export {
  GROK_RECTS_CONFIDENCE,
  GROK_RECTS_FIXTURE_ID,
  GROK_RECTS_MODULE,
  GROK_RECTS_PROMPT_VERSION,
  GRID_METERS,
  MIN_SHARED_EDGE_M,
  SNAP_METERS,
  grokRectsResultSchema,
  parseGrokRectsResult,
  type GrokRectsResult,
} from "./grok-rects-schema.js";
export { grokRectsPrompt } from "./grok-rects-prompt.js";
export { rectsToGraph, snapBoundaryNote } from "./grok-rects-graph.js";

export const GROK_RECTS_FALLBACK_WHEN = [
  "OpenCV / plan-parser returned patch: null",
  "plan-parser timeout after 60 s",
  "Validator layer «Геометрия» still has errors after proposeRepair",
  "PARSER_URL is unset and Orchestrator must skip the Python service",
] as const;

export type GrokRectsClient = {
  mode: "fixture" | "live";
  chatCompletions: (request: GrokChatRequest) => Promise<GrokChatResult>;
};

export type GrokRectsPlan = {
  imageUrl?: string;
  imageBase64?: string;
};

export type GrokRectsOverlayStatus = {
  status: "blocked";
  dependency: "builder.renderOverlay";
  note: string;
};

export type GrokRectsGeometryError = {
  code: string;
  message: string;
  entities: string[];
};

export type GrokRectsDiagnostics = {
  strategy: "grok-rects";
  promptVersion: typeof GROK_RECTS_PROMPT_VERSION;
  providerModel?: string;
  imageAttached: boolean;
  geometrySuitable: boolean;
  synthetic?: boolean;
  liveApiCalled: boolean;
  httpStatus?: number;
  note?: string;
  schemaErrors?: string[];
  intersectingRooms?: [string, string][];
  droppedDoors?: { between: [string, string]; reason: string }[];
  geometryError?: GrokRectsGeometryError;
  snap: {
    owner: "modules/ai grok-rects";
    kind: "axis-aligned-rectangles";
    gridMeters: 0.5;
    snapMeters: 0.05;
    boundary: string;
  };
  overlay: GrokRectsOverlayStatus;
};

export type GrokRectsOutput = {
  patch: Patch | null;
  reason?: string;
  diagnostics: GrokRectsDiagnostics;
};

export type GrokRectsInput = {
  /** Accepted revision to patch. Never read from env or a hidden singleton. */
  model: FlatModel;
  plan?: GrokRectsPlan;
  grok?: GrokRectsClient;
  fixtureId?: string;
};

const OVERLAY: GrokRectsOverlayStatus = {
  status: "blocked",
  dependency: "builder.renderOverlay",
  note: [
    "Matcher overlay must be renderOverlay(acceptedModel, planPng) from @flatwalk/builder/node in Node",
    "(browser: @flatwalk/builder with Canvas, never @napi-rs/canvas). grok-rects does not ship a second renderer",
    "and does not claim the pipeline through Photo Matcher is ready.",
  ].join(" "),
};

function baseDiagnostics(partial: Partial<GrokRectsDiagnostics> = {}): GrokRectsDiagnostics {
  return {
    strategy: "grok-rects",
    promptVersion: GROK_RECTS_PROMPT_VERSION,
    imageAttached: false,
    geometrySuitable: false,
    liveApiCalled: false,
    snap: {
      owner: "modules/ai grok-rects",
      kind: "axis-aligned-rectangles",
      gridMeters: 0.5,
      snapMeters: 0.05,
      boundary: snapBoundaryNote(),
    },
    overlay: OVERLAY,
    ...partial,
  };
}

function planImageUrl(plan?: GrokRectsPlan): string | undefined {
  if (plan?.imageUrl) return plan.imageUrl;
  if (plan?.imageBase64) {
    const encoded = plan.imageBase64.startsWith("data:")
      ? plan.imageBase64
      : `data:image/png;base64,${plan.imageBase64}`;
    return encoded;
  }
  return undefined;
}

function visionMessages(plan?: GrokRectsPlan) {
  const prompt = grokRectsPrompt();
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

function modelWithGraph(model: FlatModel, graph: RectGraph): FlatModel {
  const rooms: FlatModel["rooms"] = {};
  for (const id of Object.keys(graph.rooms)) {
    rooms[id] = graphRoomToContract(graph.rooms[id]!);
  }
  const plan: FlatModel["plan"] = {
    ...model.plan,
    meta: { ...assumedPlanMeta(), basis: "assumed" },
  };
  delete plan.pxPerMeter;
  return {
    ...model,
    vertices: graph.vertices,
    walls: graph.walls,
    openings: graph.openings,
    rooms,
    plan,
  };
}

function publicGeometryError(model: FlatModel): GrokRectsGeometryError | null {
  try {
    faces(model);
    for (const id of Object.keys(model.rooms).sort()) {
      roomPolygon(model, id);
    }
    adjacency(model);
    return null;
  } catch (error) {
    if (error instanceof GeometryError) {
      return { code: error.code, message: error.message, entities: [...error.entities] };
    }
    throw error;
  }
}

function setOp(path: string, value: Extract<Op, { op: "set" }>["value"]): Op {
  return { op: "set", path, value };
}

function unsetOp(path: string): Op {
  return { op: "unset", path };
}

export function grokRectsGraphToPatch(model: FlatModel, result: ReturnType<typeof parseGrokRectsJson>): GrokRectsOutput {
  if (!result.ok) {
    return {
      patch: null,
      reason: result.errors[0]?.toLowerCase().includes("json") ? "invalid-rects-json" : "invalid-rects-schema",
      diagnostics: baseDiagnostics({ schemaErrors: result.errors }),
    };
  }
  const graphResult = rectsToGraph(result.value);
  if (!graphResult.ok) {
    return {
      patch: null,
      reason: "intersecting-rectangles",
      diagnostics: baseDiagnostics({
        intersectingRooms: graphResult.intersectingRooms,
        schemaErrors: [
          `Rooms overlap: ${graphResult.intersectingRooms.map((pair) => pair.join("∩")).join(", ")}`,
        ],
      }),
    };
  }

  const { graph } = graphResult;
  const ops: Op[] = [];
  for (const id of Object.keys(model.openings).sort()) ops.push(unsetOp(`openings.${id}`));
  for (const id of Object.keys(model.walls).sort()) ops.push(unsetOp(`walls.${id}`));
  for (const id of Object.keys(model.rooms).sort()) ops.push(unsetOp(`rooms.${id}`));
  for (const id of Object.keys(model.vertices).sort()) ops.push(unsetOp(`vertices.${id}`));
  if (model.plan.pxPerMeter !== undefined) ops.push(unsetOp("plan.pxPerMeter"));

  for (const id of Object.keys(graph.vertices).sort()) {
    ops.push(setOp(`vertices.${id}`, graph.vertices[id]));
  }
  for (const id of Object.keys(graph.walls).sort()) {
    ops.push(setOp(`walls.${id}`, graph.walls[id]));
  }
  for (const id of Object.keys(graph.rooms).sort()) {
    ops.push(setOp(`rooms.${id}`, graphRoomToContract(graph.rooms[id]!)));
  }
  for (const id of Object.keys(graph.openings).sort()) {
    ops.push(setOp(`openings.${id}`, graph.openings[id]));
  }
  ops.push(setOp("plan.meta", { ...assumedPlanMeta(), basis: "assumed" }));

  const patch: Patch = {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: model.revision,
    module: GROK_RECTS_MODULE,
    ops,
  };
  const parsed = PatchSchema.safeParse(patch);
  if (!parsed.success) {
    return {
      patch: null,
      reason: "invalid-rects-patch",
      diagnostics: baseDiagnostics({
        schemaErrors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        droppedDoors: graph.droppedDoors,
      }),
    };
  }

  const geometryError = publicGeometryError(modelWithGraph(model, graph));
  if (geometryError) {
    return {
      patch: null,
      reason: "incompatible-geometry",
      diagnostics: baseDiagnostics({
        droppedDoors: graph.droppedDoors,
        geometryError,
        schemaErrors: [`Geometry Core ${geometryError.code}: ${geometryError.message}`],
      }),
    };
  }

  return {
    patch: parsed.data,
    diagnostics: baseDiagnostics({
      droppedDoors: graph.droppedDoors,
      geometrySuitable: true,
      note: `Schematic geometry; confidence ${GROK_RECTS_CONFIDENCE}; plan.meta.basis=assumed. Caller must apply() via Resolver.`,
    }),
  };
}

/**
 * Fallback Plan Parser strategy 2c.
 *
 * Example:
 *   const grok = createGrokClient({ mode: "fixture" });
 *   const { patch } = await runGrokRects({ model: rev0, plan: { imageUrl }, grok });
 *   if (patch) apply(rev0, patch, revisionContext);
 *
 * Enable this fallback when GROK_RECTS_FALLBACK_WHEN holds. Do not call it from
 * Orchestrator routing in this task; do not read Convex or global model state.
 */
export async function runGrokRects(input: GrokRectsInput): Promise<GrokRectsOutput> {
  if (!input?.model) {
    throw new TypeError("runGrokRects requires an explicit FlatModel; it does not read global state");
  }
  const grok = input.grok ?? createGrokClient();
  const fixtureId = input.fixtureId ?? GROK_RECTS_FIXTURE_ID;
  const imageAttached = Boolean(planImageUrl(input.plan));
  const chat = await grok.chatCompletions({
    fixtureId,
    model: DEFAULT_GROK_MODEL,
    messages: visionMessages(input.plan),
  });
  const providerModel = typeof chat.body.model === "string" ? chat.body.model : undefined;
  const liveApiCalled = grok.mode === "live" && chat.synthetic !== true;
  const content = chat.body.choices[0]?.message.content;
  if (typeof content !== "string" || !content.trim()) {
    return {
      patch: null,
      reason: "invalid-rects-json",
      diagnostics: baseDiagnostics({
        synthetic: chat.synthetic,
        liveApiCalled,
        providerModel,
        imageAttached,
        note: chat.note,
        schemaErrors: ["Grok completion has no text content"],
        ...(liveApiCalled ? { httpStatus: 200 } : {}),
      }),
    };
  }
  const parsed = parseGrokRectsJson(content);
  const output = grokRectsGraphToPatch(input.model, parsed);
  output.diagnostics.synthetic = chat.synthetic;
  output.diagnostics.liveApiCalled = liveApiCalled;
  output.diagnostics.providerModel = providerModel;
  output.diagnostics.imageAttached = imageAttached;
  output.diagnostics.promptVersion = GROK_RECTS_PROMPT_VERSION;
  if (liveApiCalled) output.diagnostics.httpStatus = 200;
  output.diagnostics.note = [chat.note, output.diagnostics.note].filter(Boolean).join(" ");
  if (!parsed.ok && parsed.errors[0]?.includes("not valid JSON")) {
    output.reason = "invalid-rects-json";
  }
  return output;
}

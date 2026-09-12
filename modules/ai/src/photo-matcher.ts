import { PatchSchema, type FlatModel, type Op, type Patch } from "@flatwalk/contract";
import { GeometryError, wallSide } from "@flatwalk/geometry";
import { createGrokClient, type GrokChatRequest, type GrokChatResult } from "./grok.js";
import { photoMatcherPrompt } from "./photo-matcher-prompt.js";
import {
  PHOTO_MATCHER_FIXTURE_ID,
  PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  PHOTO_MATCHER_MODULE,
  PHOTO_MATCHER_PROMPT_VERSION,
  parseGrokPhotoMatcherJson,
  type GrokPhotoMatch,
} from "./photo-matcher-schema.js";

export {
  PHOTO_MATCHER_54541_FIXTURE_ID,
  PHOTO_MATCHER_FIXTURE_ID,
  PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  PHOTO_MATCHER_LOW_CONFIDENCE,
  PHOTO_MATCHER_MODULE,
  PHOTO_MATCHER_PROMPT_VERSION,
  parseGrokPhotoMatcherJson,
  parseGrokPhotoMatcherResult,
  photoMatcherResultSchema,
  type GrokPhotoMatch,
  type GrokPhotoMatcherResult,
} from "./photo-matcher-schema.js";
export { photoMatcherPrompt } from "./photo-matcher-prompt.js";

export type PhotoMatcherClient = {
  mode: "fixture" | "live";
  chatCompletions: (request: GrokChatRequest) => Promise<GrokChatResult>;
};

export type OverlayInput = {
  imageUrl?: string;
  imageBase64?: string;
};

export type PhotoImageInput = {
  assetId: string;
  imageUrl?: string;
  imageBase64?: string;
};

export type PhotoMatcherDropped = {
  assetId?: string;
  reason:
    | "unknown-asset"
    | "unknown-room"
    | "unknown-wall"
    | "wall-not-on-room"
    | "duplicate"
    | "not-a-photo"
    | "invalid-fields";
  detail?: string;
};

export type PhotoMatcherDiagnostics = {
  module: typeof PHOTO_MATCHER_MODULE;
  promptVersion: typeof PHOTO_MATCHER_PROMPT_VERSION;
  fixtureId: string;
  synthetic?: boolean;
  liveApiCalled: boolean;
  note?: string;
  schemaErrors?: string[];
  dropped: PhotoMatcherDropped[];
  raw?: string;
};

export type PhotoMatcherOutput = {
  patch: Patch | null;
  reason?: string;
  diagnostics: PhotoMatcherDiagnostics;
};

export type PhotoMatcherInput = {
  model: FlatModel;
  overlay: OverlayInput;
  photos?: PhotoImageInput[];
  grok?: PhotoMatcherClient;
  fixtureId?: string;
  timeoutMs?: number;
};

function imageUrl(source?: { imageUrl?: string; imageBase64?: string }): string | undefined {
  if (source?.imageUrl) return source.imageUrl;
  if (source?.imageBase64) {
    return source.imageBase64.startsWith("data:")
      ? source.imageBase64
      : `data:image/png;base64,${source.imageBase64}`;
  }
  return undefined;
}

function setOp(path: string, value: Extract<Op, { op: "set" }>["value"]): Op {
  return { op: "set", path, value };
}

function photoIds(model: FlatModel): string[] {
  return Object.entries(model.assets)
    .filter(([, asset]) => asset.kind === "photo")
    .map(([id]) => id)
    .sort();
}

function wallOnRoom(model: FlatModel, wallId: string, roomId: string): boolean {
  try {
    wallSide(model, wallId, roomId);
    return true;
  } catch (error) {
    if (error instanceof GeometryError) return false;
    throw error;
  }
}

function questionFor(match: { roomId: string | null; confidence: number }): string | undefined {
  if (match.roomId === null) {
    return "Photo is not an interior of a listed room (facade, stair, or view out).";
  }
  if (match.confidence < PHOTO_MATCHER_LOW_CONFIDENCE) {
    return "Low confidence photo-to-room match; similar rooms need human review.";
  }
  return undefined;
}

function visionMessages(input: PhotoMatcherInput) {
  const rooms = Object.entries(input.model.rooms)
    .map(([id, room]) => ({ id, type: room.type }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const walls = Object.keys(input.model.walls).sort();
  const ids = photoIds(input.model);
  const prompt = photoMatcherPrompt({ rooms, walls, photoIds: ids });
  const overlayUrl = imageUrl(input.overlay);
  const parts: Array<Record<string, unknown>> = [];
  if (overlayUrl) {
    parts.push({ type: "text", text: "Overlay of the accepted revision:" });
    parts.push({ type: "image_url", image_url: { url: overlayUrl, detail: "high" } });
  }
  for (const photo of input.photos ?? []) {
    const url = imageUrl(photo);
    if (!url) continue;
    parts.push({ type: "text", text: `Photo assetId=${photo.assetId}` });
    parts.push({ type: "image_url", image_url: { url, detail: "high" } });
  }
  parts.push({ type: "text", text: prompt.user });
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: parts },
  ];
}

function bindPhoto(
  model: FlatModel,
  match: GrokPhotoMatch,
  seen: Set<string>,
  dropped: PhotoMatcherDropped[],
): GrokPhotoMatch | null {
  if (seen.has(match.assetId)) {
    dropped.push({ assetId: match.assetId, reason: "duplicate" });
    return null;
  }
  seen.add(match.assetId);
  const asset = model.assets[match.assetId];
  if (!asset) {
    dropped.push({ assetId: match.assetId, reason: "unknown-asset" });
    return null;
  }
  if (asset.kind !== "photo") {
    dropped.push({ assetId: match.assetId, reason: "not-a-photo" });
    return null;
  }
  if (match.roomId !== null && !model.rooms[match.roomId]) {
    dropped.push({ assetId: match.assetId, reason: "unknown-room", detail: match.roomId });
    return null;
  }
  if (match.roomId === null) {
    if (match.wallId) {
      dropped.push({ assetId: match.assetId, reason: "unknown-wall", detail: "wall without room" });
    }
    return { ...match, wallId: null, confidence: 0 };
  }
  if (!match.wallId) {
    return { ...match, wallId: null };
  }
  if (!model.walls[match.wallId]) {
    dropped.push({ assetId: match.assetId, reason: "unknown-wall", detail: match.wallId });
    return { ...match, wallId: null };
  }
  if (!wallOnRoom(model, match.wallId, match.roomId)) {
    dropped.push({
      assetId: match.assetId,
      reason: "wall-not-on-room",
      detail: `${match.wallId} not on ${match.roomId}`,
    });
    return { ...match, wallId: null };
  }
  return match;
}

function matchesToPatch(model: FlatModel, matches: GrokPhotoMatch[]): Patch {
  const ops: Op[] = [];
  for (const match of matches) {
    const confidence = match.roomId === null ? 0 : match.confidence;
    const question = questionFor({ roomId: match.roomId, confidence });
    ops.push(setOp(`assets.${match.assetId}.room`, match.roomId));
    ops.push(setOp(`assets.${match.assetId}.faces`, match.wallId));
    ops.push(setOp(`assets.${match.assetId}.look`, { floor: match.floor, wallTone: match.wallTone }));
    ops.push(
      setOp(`assets.${match.assetId}.meta`, {
        provenance: PHOTO_MATCHER_MODULE,
        basis: "inferred",
        confidence,
        ...(question ? { question } : {}),
      }),
    );
  }
  return {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: model.revision,
    module: PHOTO_MATCHER_MODULE,
    ops,
  };
}

function baseDiagnostics(partial: Partial<PhotoMatcherDiagnostics> = {}): PhotoMatcherDiagnostics {
  return {
    module: PHOTO_MATCHER_MODULE,
    promptVersion: PHOTO_MATCHER_PROMPT_VERSION,
    fixtureId: PHOTO_MATCHER_FIXTURE_ID,
    liveApiCalled: false,
    dropped: [],
    ...partial,
  };
}

export async function runPhotoMatcher(input: PhotoMatcherInput): Promise<PhotoMatcherOutput> {
  if (!input?.model) {
    throw new TypeError("runPhotoMatcher requires an explicit FlatModel; it does not read global state");
  }
  if (!input.overlay) {
    throw new TypeError("runPhotoMatcher requires an explicit overlay from renderOverlay; it does not render one");
  }

  const grok = input.grok ?? createGrokClient();
  const fixtureId = input.fixtureId ?? PHOTO_MATCHER_FIXTURE_ID;
  const chat = await grok.chatCompletions({
    fixtureId,
    messages: visionMessages(input),
    timeoutMs: input.timeoutMs ?? PHOTO_MATCHER_LIVE_TIMEOUT_MS,
  });
  const content = chat.body.choices[0]?.message.content;
  const common = {
    synthetic: chat.synthetic,
    liveApiCalled: grok.mode === "live" && chat.synthetic !== true,
    note: chat.note,
    fixtureId,
    raw: typeof content === "string" ? content : undefined,
  };

  if (typeof content !== "string" || !content.trim()) {
    return {
      patch: null,
      reason: "invalid-matcher-json",
      diagnostics: baseDiagnostics({
        ...common,
        schemaErrors: ["Grok completion has no text content"],
      }),
    };
  }

  const parsed = parseGrokPhotoMatcherJson(content);
  if (!parsed.ok) {
    return {
      patch: null,
      reason: parsed.errors[0]?.includes("not valid JSON") ? "invalid-matcher-json" : "invalid-matcher-schema",
      diagnostics: baseDiagnostics({ ...common, schemaErrors: parsed.errors }),
    };
  }

  const dropped: PhotoMatcherDropped[] = [];
  const seen = new Set<string>();
  const accepted: GrokPhotoMatch[] = [];
  for (const match of parsed.value.photos) {
    const bound = bindPhoto(input.model, match, seen, dropped);
    if (bound) accepted.push(bound);
  }

  const patch = matchesToPatch(input.model, accepted);
  const checked = PatchSchema.safeParse(patch);
  if (!checked.success) {
    return {
      patch: null,
      reason: "invalid-matcher-patch",
      diagnostics: baseDiagnostics({
        ...common,
        dropped,
        schemaErrors: checked.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }),
    };
  }

  return {
    patch: checked.data,
    diagnostics: baseDiagnostics({ ...common, dropped }),
  };
}

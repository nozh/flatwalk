export const PHOTO_MATCHER_MODULE = "photo-matcher/grok@0.1";
export const PHOTO_MATCHER_PROMPT_VERSION = "photo-matcher/grok@0.1";
export const PHOTO_MATCHER_FIXTURE_ID = "grok/photo-matcher.synthetic";
export const PHOTO_MATCHER_54541_FIXTURE_ID = "grok/photo-matcher.54541";
export const PHOTO_MATCHER_LOW_CONFIDENCE = 0.6;
export const PHOTO_MATCHER_LIVE_TIMEOUT_MS = 180_000;

export const FLOORS = ["parquet", "tile", "laminate", "unknown"] as const;
export const WALL_TONES = ["light", "dark", "colored"] as const;

export type PhotoFloor = (typeof FLOORS)[number];
export type PhotoWallTone = (typeof WALL_TONES)[number];

export type GrokPhotoMatch = {
  assetId: string;
  roomId: string | null;
  wallId: string | null;
  confidence: number;
  floor: PhotoFloor;
  wallTone: PhotoWallTone;
};

export type GrokPhotoMatcherResult = {
  photos: GrokPhotoMatch[];
};

export const photoMatcherResultSchema = {
  $id: "flatwalk.photo-matcher.result",
  title: "GrokPhotoMatcherResult",
  type: "object",
  additionalProperties: false,
  required: ["photos"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["assetId", "roomId", "confidence", "floor", "wallTone"],
        properties: {
          assetId: { type: "string" },
          roomId: { type: ["string", "null"] },
          wallId: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          floor: { enum: [...FLOORS] },
          wallTone: { enum: [...WALL_TONES] },
        },
      },
    },
  },
} as const;

export type ParsePhotoMatcherResult =
  | { ok: true; value: GrokPhotoMatcherResult }
  | { ok: false; errors: string[] };

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const FLOOR_SET = new Set<string>(FLOORS);
const TONE_SET = new Set<string>(WALL_TONES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export function parseGrokPhotoMatcherJson(content: string): ParsePhotoMatcherResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(content));
  } catch (error) {
    return {
      ok: false,
      errors: [`Response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return parseGrokPhotoMatcherResult(parsed);
}

export function parseGrokPhotoMatcherResult(input: unknown): ParsePhotoMatcherResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["GrokPhotoMatcherResult must be an object"] };
  }
  if ("schemaVersion" in input || "vertices" in input || "revision" in input) {
    errors.push("Payload looks like FlatModel; photo-matcher expects photos[]");
  }
  if (!Array.isArray(input.photos)) {
    errors.push("photos must be an array");
  }
  const extra = Object.keys(input).filter((key) => key !== "photos");
  if (extra.length) errors.push(`Unexpected keys: ${extra.join(", ")}`);

  const photos: GrokPhotoMatch[] = [];
  if (Array.isArray(input.photos)) {
    input.photos.forEach((raw, index) => {
      if (!isRecord(raw)) {
        errors.push(`photos[${index}] must be an object`);
        return;
      }
      const extraPhoto = Object.keys(raw).filter(
        (key) => !["assetId", "roomId", "wallId", "confidence", "floor", "wallTone"].includes(key),
      );
      if (extraPhoto.length) errors.push(`photos[${index}] unexpected keys: ${extraPhoto.join(", ")}`);
      if (typeof raw.assetId !== "string" || !ID_RE.test(raw.assetId)) {
        errors.push(`photos[${index}].assetId is not a Contract id`);
        return;
      }
      const roomOk = raw.roomId === null || (typeof raw.roomId === "string" && ID_RE.test(raw.roomId));
      if (!roomOk) {
        errors.push(`photos[${index}].roomId must be a Contract id or null`);
        return;
      }
      const wallMissing = !("wallId" in raw);
      const wallOk =
        wallMissing || raw.wallId === null || (typeof raw.wallId === "string" && ID_RE.test(raw.wallId));
      if (!wallOk) {
        errors.push(`photos[${index}].wallId must be a Contract id or null`);
        return;
      }
      if (!isConfidence(raw.confidence)) {
        errors.push(`photos[${index}].confidence must be a number in [0, 1]`);
        return;
      }
      if (typeof raw.floor !== "string" || !FLOOR_SET.has(raw.floor)) {
        errors.push(`photos[${index}].floor is not parquet|tile|laminate|unknown`);
        return;
      }
      if (typeof raw.wallTone !== "string" || !TONE_SET.has(raw.wallTone)) {
        errors.push(`photos[${index}].wallTone is not light|dark|colored`);
        return;
      }
      photos.push({
        assetId: raw.assetId,
        roomId: raw.roomId as string | null,
        wallId: wallMissing ? null : (raw.wallId as string | null),
        confidence: raw.confidence,
        floor: raw.floor as PhotoFloor,
        wallTone: raw.wallTone as PhotoWallTone,
      });
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { photos } };
}

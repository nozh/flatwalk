export const GROK_RECTS_MODULE = "plan-parser/grok-rects@0.1";
export const GROK_RECTS_CONFIDENCE = 0.5;
export const GROK_RECTS_FIXTURE_ID = "grok/grok-rects.synthetic";
export const GROK_RECTS_PROMPT_VERSION = "plan-parser/grok-rects-prompt@0.1";
export const GRID_METERS = 0.5;
export const SNAP_METERS = 0.05;
export const MIN_SHARED_EDGE_M = 0.8;
export const DEFAULT_DOOR_WIDTH = 0.9;
export const DEFAULT_WALL_THICKNESS = 0.2;

export const ROOM_TYPES = [
  "living",
  "bedroom",
  "kitchen",
  "bathroom",
  "wc",
  "hall",
  "corridor",
  "storage",
  "unknown",
] as const;

export type GrokRectsRoomType = (typeof ROOM_TYPES)[number];

export type GrokRectsRoom = {
  id: string;
  type: GrokRectsRoomType;
  /** Axis-aligned rectangle in 0.5 m grid cells: [x, y, width, height]. */
  rect: [number, number, number, number];
};

export type GrokRectsDoor = {
  between: [string, string];
};

export type GrokRectsResult = {
  rooms: GrokRectsRoom[];
  doors: GrokRectsDoor[];
  entrance: string;
};

/** Provider JSON shape. This is not FlatModel and must not be applied as a patch. */
export const grokRectsResultSchema = {
  $id: "flatwalk.grok-rects.result",
  title: "GrokRectsResult",
  type: "object",
  additionalProperties: false,
  required: ["rooms", "doors", "entrance"],
  properties: {
    rooms: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "rect"],
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9_][A-Za-z0-9_-]*$" },
          type: { enum: [...ROOM_TYPES] },
          rect: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "number" },
          },
        },
      },
    },
    doors: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["between"],
        properties: {
          between: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string" },
          },
        },
      },
    },
    entrance: { type: "string" },
  },
} as const;

export type ParseGrokRectsResult =
  | { ok: true; value: GrokRectsResult }
  | { ok: false; errors: string[] };

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;
const ROOM_TYPE_SET = new Set<string>(ROOM_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function extractJsonText(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

export function parseGrokRectsJson(content: string): ParseGrokRectsResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(content));
  } catch (error) {
    return {
      ok: false,
      errors: [`Response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  return parseGrokRectsResult(parsed);
}

export function parseGrokRectsResult(input: unknown): ParseGrokRectsResult {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["GrokRectsResult must be an object"] };
  }
  if ("schemaVersion" in input || "vertices" in input || "revision" in input) {
    errors.push("Payload looks like FlatModel; grok-rects expects rooms[].rect, doors[], entrance");
  }
  if (!Array.isArray(input.rooms) || input.rooms.length < 1) {
    errors.push("rooms must be a non-empty array");
  }
  if (!Array.isArray(input.doors)) {
    errors.push("doors must be an array");
  }
  if (typeof input.entrance !== "string" || !ID_RE.test(input.entrance)) {
    errors.push("entrance must be a Contract id string");
  }
  const extra = Object.keys(input).filter((key) => !["rooms", "doors", "entrance"].includes(key));
  if (extra.length) errors.push(`Unexpected keys: ${extra.join(", ")}`);

  const rooms: GrokRectsRoom[] = [];
  const seen = new Set<string>();
  if (Array.isArray(input.rooms)) {
    input.rooms.forEach((raw, index) => {
      if (!isRecord(raw)) {
        errors.push(`rooms[${index}] must be an object`);
        return;
      }
      const extraRoom = Object.keys(raw).filter((key) => !["id", "type", "rect"].includes(key));
      if (extraRoom.length) errors.push(`rooms[${index}] unexpected keys: ${extraRoom.join(", ")}`);
      if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) {
        errors.push(`rooms[${index}].id is not a Contract id`);
        return;
      }
      if (seen.has(raw.id)) {
        errors.push(`duplicate room id ${raw.id}`);
        return;
      }
      seen.add(raw.id);
      if (typeof raw.type !== "string" || !ROOM_TYPE_SET.has(raw.type)) {
        errors.push(`rooms[${index}].type is not a known room type`);
        return;
      }
      if (
        !Array.isArray(raw.rect) ||
        raw.rect.length !== 4 ||
        !raw.rect.every(isFiniteNumber) ||
        raw.rect[2] <= 0 ||
        raw.rect[3] <= 0
      ) {
        errors.push(`rooms[${index}].rect must be [x, y, w, h] with positive w,h`);
        return;
      }
      rooms.push({
        id: raw.id,
        type: raw.type as GrokRectsRoomType,
        rect: [raw.rect[0], raw.rect[1], raw.rect[2], raw.rect[3]],
      });
    });
  }

  const doors: GrokRectsDoor[] = [];
  if (Array.isArray(input.doors)) {
    input.doors.forEach((raw, index) => {
      if (!isRecord(raw) || !Array.isArray(raw.between) || raw.between.length !== 2) {
        errors.push(`doors[${index}].between must be [roomId, roomId]`);
        return;
      }
      const extraDoor = Object.keys(raw).filter((key) => key !== "between");
      if (extraDoor.length) errors.push(`doors[${index}] unexpected keys: ${extraDoor.join(", ")}`);
      const [a, b] = raw.between;
      if (typeof a !== "string" || typeof b !== "string" || !ID_RE.test(a) || !ID_RE.test(b)) {
        errors.push(`doors[${index}].between ids are invalid`);
        return;
      }
      if (a === b) {
        errors.push(`doors[${index}] cannot connect a room to itself`);
        return;
      }
      if (!seen.has(a) || !seen.has(b)) {
        errors.push(`doors[${index}] references unknown room ${!seen.has(a) ? a : b}`);
        return;
      }
      doors.push({ between: [a, b] });
    });
  }

  if (typeof input.entrance === "string" && seen.size && !seen.has(input.entrance)) {
    errors.push(`entrance ${input.entrance} is not in rooms`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      rooms,
      doors,
      entrance: input.entrance as string,
    },
  };
}

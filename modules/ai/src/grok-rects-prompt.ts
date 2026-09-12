import { GRID_METERS, ROOM_TYPES, grokRectsResultSchema } from "./grok-rects-schema.js";

export function grokRectsPrompt(): { system: string; user: string } {
  return {
    system: [
      "You reconstruct a schematic floor plan as axis-aligned room rectangles.",
      `Use a regular ${GRID_METERS} m grid (coordinates are integer or half-integer cells on that grid).`,
      "Do not return a FlatModel, vertices, walls, or pixel coordinates.",
      "Reply with a single JSON object that matches the provider schema, no markdown.",
    ].join(" "),
    user: [
      "Look at the source plan image.",
      "Return JSON with:",
      "- rooms: [{ id, type, rect: [x, y, w, h] }] where id matches [A-Za-z0-9_][A-Za-z0-9_-]*,",
      `  type is one of ${ROOM_TYPES.join(", ")},`,
      `  and rect is in ${GRID_METERS} m cells, origin at the top-left of the plan, x right, y down.`,
      "- doors: [{ between: [roomId, roomId] }] for interior doors. Only link rooms that share a wall on the plan.",
      "- entrance: the id of the room that contains the street/building entrance (not an opening id).",
      "Keep rectangles non-overlapping. Touching at a shared edge is required for a door.",
      "Align neighbouring rooms to the same grid lines so shared walls coincide.",
      `Provider schema (not FlatModel): ${JSON.stringify(grokRectsResultSchema)}`,
    ].join("\n"),
  };
}

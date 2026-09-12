import { photoMatcherResultSchema } from "./photo-matcher-schema.js";

export type PhotoMatcherPromptInput = {
  rooms: Array<{ id: string; type: string }>;
  walls: string[];
  photoIds: string[];
};

export function photoMatcherPrompt(input: PhotoMatcherPromptInput): { system: string; user: string } {
  return {
    system: [
      "You match listing photographs to rooms on a labelled floor-plan overlay.",
      "Use only the provided room, wall and photo ids. Do not invent ids or change geometry.",
      "Exterior shots (facade, entrance hall of the building, view through a window to the street) get roomId null.",
      "If two interiors look similar, keep confidence below 0.6 rather than guessing.",
      "Reply with a single JSON object that matches the provider schema, no markdown.",
    ].join(" "),
    user: [
      "The first image is the overlay of the accepted plan revision (rooms r*, walls w* labelled).",
      "The following images are original listing photos, each captioned with its assetId.",
      `Allowed rooms: ${JSON.stringify(input.rooms)}`,
      `Allowed walls: ${JSON.stringify(input.walls)}`,
      `Allowed photo assetIds: ${JSON.stringify(input.photoIds)}`,
      "Return JSON { photos: [{ assetId, roomId, wallId, confidence, floor, wallTone }] }.",
      "roomId is a room id or null. wallId is a wall on that room's contour, or null if the wall is unknown.",
      "floor is parquet|tile|laminate|unknown. wallTone is light|dark|colored.",
      "confidence is 0..1. Unbound photos (roomId null) must use confidence 0.",
      `Provider schema (not FlatModel): ${JSON.stringify(photoMatcherResultSchema)}`,
    ].join("\n"),
  };
}

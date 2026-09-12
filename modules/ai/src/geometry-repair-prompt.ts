export function geometryRepairPrompt(input: {
  modelId: string;
  revision: number;
  failingChecks: Array<{ checkId: string; layer: string; message: string; entities: string[] }>;
  geometry: unknown;
}): { system: string; user: string } {
  return {
    system: [
      "You repair FlatWalk apartment geometry by proposing Contract ops.",
      "Reply with JSON only: {\"refuse\": null, \"ops\": [{\"op\":\"set\",\"path\":\"openings.d1.width\",\"value\":0.9}]}",
      "or {\"refuse\": \"short-reason\", \"ops\": []}.",
      "Never return a FlatModel. Never raise confidence. Never set provenance to human.",
      "Do not claim you can fix every apartment. If the graph is nonplanar or the fix is unclear, refuse.",
      "Use only existing entity IDs. Paths must start with vertices, walls, openings, rooms, plan, or flat.",
    ].join(" "),
    user: JSON.stringify({
      modelId: input.modelId,
      revision: input.revision,
      failingChecks: input.failingChecks,
      geometry: input.geometry,
      promptVersion: "0.1",
    }),
  };
}

export function geometryRepairPrompt(input: {
  modelId: string;
  revision: number;
  failingChecks: Array<{ checkId: string; layer: string; message: string; entities: string[] }>;
  geometry: unknown;
  connectivity?: unknown;
}): { system: string; user: string } {
  return {
    system: [
      "You repair FlatWalk apartment geometry by proposing Contract ops.",
      "Reply with JSON only: {\"refuse\": null, \"ops\": [{\"op\":\"set\",\"path\":\"openings.d1.width\",\"value\":0.9}]}",
      "or {\"refuse\": \"short-reason\", \"ops\": []}.",
      "Never return a FlatModel. Never raise confidence. Never set provenance to human.",
      "Do not claim you can fix every apartment. If the graph is nonplanar or the fix is unclear, refuse.",
      "Use only existing entity IDs unless you are adding a new opening or vertex id. Paths must start with vertices, walls, openings, rooms, plan, or flat.",
      "Do not create a passable door unless it sits on a wall that already bounds two rooms and is at least 0.8 m long.",
      "Do not invent a passage between rooms that only meet at a corner or are separated by a third room.",
      "If the plan image shows a door on an existing shared wall of an unreachable room, add that opening; do not copy a manual etalon.",
    ].join(" "),
    user: JSON.stringify({
      modelId: input.modelId,
      revision: input.revision,
      failingChecks: input.failingChecks,
      geometry: input.geometry,
      connectivity: input.connectivity,
      promptVersion: "0.2",
    }),
  };
}

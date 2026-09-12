import { PatchSchema, type FlatModel, type Meta, type Op, type Patch, type Room } from "@flatwalk/contract";

export const DRESSER_MODULE = "dresser@0.1";
export const DRESSING_MATERIALS = ["parquet", "tile", "laminate"] as const;

export type DressingMaterial = (typeof DRESSING_MATERIALS)[number];
export type DresserFloorSource = "look-mode" | "tie-break" | "type-fallback";

export type DresserRoomDecision = {
  roomId: string;
  floor: DressingMaterial;
  source: DresserFloorSource;
  votes: Record<DressingMaterial, number>;
  skippedHuman: string[];
};

export type DresserL1Diagnostics = {
  module: typeof DRESSER_MODULE;
  liveApiCalled: false;
  rooms: DresserRoomDecision[];
};

export type DresserL1Output = {
  patch: Patch;
  diagnostics: DresserL1Diagnostics;
};

export type DresserL1Input = {
  model: FlatModel;
};

const TILE_ROOM_TYPES = new Set<Room["type"]>(["bathroom", "wc", "kitchen"]);

function setOp(path: string, value: Extract<Op, { op: "set" }>["value"]): Op {
  return { op: "set", path, value };
}

export function typeFallbackFloor(type: Room["type"]): DressingMaterial {
  return TILE_ROOM_TYPES.has(type) ? "tile" : "parquet";
}

export function lookFloorVotes(model: FlatModel, roomId: string): Record<DressingMaterial, number> {
  const votes: Record<DressingMaterial, number> = { parquet: 0, tile: 0, laminate: 0 };
  for (const asset of Object.values(model.assets)) {
    if (asset.kind !== "photo" || asset.room !== roomId) continue;
    const floor = asset.look?.floor;
    if (floor === "parquet" || floor === "tile" || floor === "laminate") votes[floor] += 1;
  }
  return votes;
}

export function chooseL1Floor(
  type: Room["type"],
  votes: Record<DressingMaterial, number>,
): { floor: DressingMaterial; source: DresserFloorSource } {
  const fallback = typeFallbackFloor(type);
  const total = DRESSING_MATERIALS.reduce((sum, material) => sum + votes[material], 0);
  if (total === 0) return { floor: fallback, source: "type-fallback" };
  const max = Math.max(...DRESSING_MATERIALS.map((material) => votes[material]));
  const winners = DRESSING_MATERIALS.filter((material) => votes[material] === max);
  if (winners.length === 1) return { floor: winners[0]!, source: "look-mode" };
  if (winners.includes(fallback)) return { floor: fallback, source: "tie-break" };
  return { floor: winners[0]!, source: "tie-break" };
}

function isHuman(meta: Meta | undefined): boolean {
  return meta?.provenance === "human";
}

function sameSlot(
  value: unknown,
  meta: Meta | undefined,
  nextValue: unknown,
  nextMeta: Meta,
): boolean {
  return value === nextValue && meta?.provenance === nextMeta.provenance && meta?.basis === nextMeta.basis;
}

function slotMeta(
  source: DresserFloorSource,
  votes: Record<DressingMaterial, number>,
  floor: DressingMaterial,
): Meta {
  if (source === "type-fallback") {
    return { provenance: DRESSER_MODULE, basis: "assumed" };
  }
  const total = DRESSING_MATERIALS.reduce((sum, material) => sum + votes[material], 0);
  return {
    provenance: DRESSER_MODULE,
    basis: "inferred",
    confidence: votes[floor] / total,
  };
}

function roomOps(model: FlatModel, roomId: string, decision: DresserRoomDecision): Op[] {
  const room = model.rooms[roomId];
  if (!room) return [];
  const dressing = room.dressing;
  const floorMeta = slotMeta(decision.source, decision.votes, decision.floor);
  const levelMeta = floorMeta;
  const skipFloor = isHuman(dressing?.meta.floor);
  const skipLevel = isHuman(dressing?.meta.level) || dressing?.level === 2;
  if (skipFloor) decision.skippedHuman.push("floor");
  if (isHuman(dressing?.meta.level)) decision.skippedHuman.push("level");

  if (!dressing) {
    if (skipFloor || skipLevel) return [];
    return [
      setOp(`rooms.${roomId}.dressing`, {
        level: 1,
        floor: decision.floor,
        meta: { level: levelMeta, floor: floorMeta },
      }),
    ];
  }

  const ops: Op[] = [];
  if (!skipLevel && !sameSlot(dressing.level, dressing.meta.level, 1, levelMeta)) {
    ops.push(setOp(`rooms.${roomId}.dressing.level`, 1));
    ops.push(setOp(`rooms.${roomId}.dressing.meta.level`, levelMeta));
  }
  if (!skipFloor && !sameSlot(dressing.floor, dressing.meta.floor, decision.floor, floorMeta)) {
    ops.push(setOp(`rooms.${roomId}.dressing.floor`, decision.floor));
    ops.push(setOp(`rooms.${roomId}.dressing.meta.floor`, floorMeta));
  }
  return ops;
}

export function runDresserL1(input: DresserL1Input): DresserL1Output {
  if (!input?.model) {
    throw new TypeError("runDresserL1 requires an explicit FlatModel; it does not read global state");
  }

  const rooms: DresserRoomDecision[] = [];
  const ops: Op[] = [];
  for (const roomId of Object.keys(input.model.rooms).sort()) {
    const room = input.model.rooms[roomId]!;
    const votes = lookFloorVotes(input.model, roomId);
    const choice = chooseL1Floor(room.type, votes);
    const decision: DresserRoomDecision = {
      roomId,
      floor: choice.floor,
      source: choice.source,
      votes,
      skippedHuman: [],
    };
    ops.push(...roomOps(input.model, roomId, decision));
    rooms.push(decision);
  }

  const patch: Patch = {
    schemaVersion: "0.1",
    modelId: input.model.id,
    baseRevision: input.model.revision,
    module: DRESSER_MODULE,
    ops,
  };
  const checked = PatchSchema.parse(patch);

  return {
    patch: checked,
    diagnostics: {
      module: DRESSER_MODULE,
      liveApiCalled: false,
      rooms,
    },
  };
}

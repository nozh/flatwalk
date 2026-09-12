import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGeometryRepair, type GeometryRepairClient } from "@flatwalk/ai/geometry-repair";
import type { FlatModel } from "@flatwalk/contract";
import { persistGeometryRepair } from "../src/repair.ts";
import { requireRunDir } from "../src/layout.ts";
import { loadLatestModel, writeModelFiles } from "../src/model-io.ts";
import { writeHistory } from "../src/history.ts";
import { runPaths } from "../src/paths.ts";

const META = { provenance: "importer@0.1", basis: "assumed" as const };

function twoRooms(over: Record<string, unknown> = {}): FlatModel {
  return {
    schemaVersion: "0.1",
    id: "val-synth",
    revision: 1,
    source: { site: "manual", fetchedAt: "2026-09-12T10:00:00Z" },
    flat: {
      meta: { provenance: "importer@0.1", basis: "declared" },
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: {
          wallHeight: { ...META },
          doorHeight: { ...META },
          windowSill: { ...META },
          windowHeight: { ...META },
        },
      },
    },
    plan: { asset: null, meta: { ...META } },
    vertices: {
      v1: [0, 0],
      v2: [4, 0],
      v3: [8, 0],
      v4: [8, 3],
      v5: [4, 3],
      v6: [0, 3],
    },
    walls: {
      w12: { a: "v1", b: "v2", thickness: 0.2, exterior: true, meta: { ...META } },
      w23: { a: "v2", b: "v3", thickness: 0.2, exterior: true, meta: { ...META } },
      w34: { a: "v3", b: "v4", thickness: 0.2, exterior: true, meta: { ...META } },
      w45: { a: "v4", b: "v5", thickness: 0.2, exterior: true, meta: { ...META } },
      w56: { a: "v5", b: "v6", thickness: 0.2, exterior: true, meta: { ...META } },
      w61: { a: "v6", b: "v1", thickness: 0.2, exterior: true, meta: { ...META } },
      w25: { a: "v2", b: "v5", thickness: 0.2, exterior: false, meta: { ...META } },
    },
    openings: {
      d1: { wall: "w25", kind: "door", at: 1, width: 1, meta: { ...META } },
      enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
    },
    rooms: {
      left: { anchor: [2, 1.5], type: "living", label: "Left", meta: { ...META } },
      right: { anchor: [6, 1.5], type: "bedroom", label: "Right", meta: { ...META } },
    },
    assets: {},
    ...over,
  } as FlatModel;
}

function doorEntrance(opening: FlatModel["openings"][string] | undefined): boolean {
  return Boolean(opening && opening.kind === "door" && opening.entrance === true);
}

function grokQueue(contents: string[]): GeometryRepairClient {
  let i = 0;
  return {
    mode: "fixture",
    chatCompletions: async () => {
      const content = contents[i++];
      if (content === undefined) throw new Error("unexpected Grok call");
      return {
        synthetic: true,
        body: { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] },
      };
    },
  };
}

async function seededRun(model: FlatModel): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flatwalk-cli-repair-"));
  await requireRunDir(dir);
  await writeModelFiles(dir, model);
  await writeHistory(dir, {
    schemaVersion: "0.1",
    modelId: model.id,
    baseRevision: 0,
    currentRevision: model.revision,
    changes: [{ revision: 1, touchedPaths: ["openings.d1"], touchedOwners: ["openings.d1"] }],
  });
  return dir;
}

describe("persistGeometryRepair", () => {
  it("stores two sequential Resolver snapshots and does not re-apply result.patch", async () => {
    const model = twoRooms({
      openings: {
        d1: { wall: "w25", kind: "door", at: 0.8, width: 0.4, meta: { ...META } },
        d2: { wall: "w25", kind: "door", at: 1.4, width: 1, meta: { ...META } },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.d1.width", value: 0.9 }] }),
      JSON.stringify({ refuse: null, ops: [{ op: "set", path: "openings.enter.entrance", value: true }] }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.attempts).toHaveLength(2);
    expect(result.patch?.baseRevision).toBe(2);

    const dir = await seededRun(model);
    try {
      const status = await persistGeometryRepair(dir, model, result);
      expect(status).toBe("applied");
      const latest = await loadLatestModel(dir);
      expect(latest.revision).toBe(3);
      expect(latest.openings.d1?.width).toBe(0.9);
      expect(doorEntrance(latest.openings.enter)).toBe(true);
      expect(latest.revision).toBe(result.model.revision);

      const mid = JSON.parse(await readFile(runPaths(dir).revision(2), "utf8")) as FlatModel;
      expect(mid.openings.d1?.width).toBe(0.9);
      expect(doorEntrance(mid.openings.enter)).toBe(false);

      const history = JSON.parse(await readFile(runPaths(dir).history, "utf8")) as {
        currentRevision: number;
        changes: Array<{ revision: number; touchedPaths: string[]; touchedOwners: string[] }>;
      };
      expect(history.currentRevision).toBe(3);
      expect(history.changes.map((change) => change.revision)).toEqual([1, 2, 3]);
      expect(history.changes[1]?.touchedPaths).toEqual(result.attempts[0]?.apply?.touchedPaths);
      expect(history.changes[1]?.touchedOwners).toEqual(result.attempts[0]?.apply?.touchedOwners);
      expect(history.changes[2]?.touchedPaths).toEqual(result.attempts[1]?.apply?.touchedPaths);
      expect(history.changes[2]?.touchedOwners).toEqual(result.attempts[1]?.apply?.touchedOwners);
      expect(result.patch?.baseRevision).toBe(2);
      expect(result.patch?.ops.some((op) => op.path.includes("enter"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores a revision that includes rejected ops without re-applying the last patch", async () => {
    const model = twoRooms({
      openings: {
        d1: {
          wall: "w25",
          kind: "door",
          at: 1,
          width: 0.4,
          meta: { provenance: "human", basis: "declared", confidence: 0.4, reviewed: true },
        },
        enter: { wall: "w61", kind: "door", at: 1, width: 1, entrance: true, meta: { ...META } },
      },
    });
    const grok = grokQueue([
      JSON.stringify({
        refuse: null,
        ops: [
          { op: "set", path: "openings.d1.width", value: 0.9 },
          { op: "set", path: "rooms.left.label", value: "Living" },
        ],
      }),
    ]);
    const result = await runGeometryRepair({ model, grok });
    expect(result.attempts[0]?.apply?.rejected.length).toBeGreaterThan(0);
    expect(result.attempts[0]?.apply?.applied.length).toBeGreaterThan(0);

    const dir = await seededRun(model);
    try {
      await persistGeometryRepair(dir, model, result);
      const latest = await loadLatestModel(dir);
      expect(latest.revision).toBe(model.revision + 1);
      expect(latest.openings.d1?.width).toBe(0.4);
      expect(latest.rooms.left?.label).toBe("Living");
      expect(latest.revision).toBe(result.model.revision);
      const history = JSON.parse(await readFile(runPaths(dir).history, "utf8")) as {
        currentRevision: number;
        changes: Array<{ revision: number; touchedPaths: string[]; touchedOwners: string[] }>;
      };
      expect(history.currentRevision).toBe(latest.revision);
      expect(history.changes.at(-1)?.touchedPaths).toEqual(result.attempts[0]?.apply?.touchedPaths);
      expect(history.changes.at(-1)?.touchedOwners).toEqual(result.attempts[0]?.apply?.touchedOwners);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

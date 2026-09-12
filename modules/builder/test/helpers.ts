import type { FlatModel, Meta } from '@flatwalk/contract';

export const META: Meta = { provenance: 'builder-test@0.1', basis: 'inferred' };

const defaultMeta = {
  wallHeight: META,
  doorHeight: META,
  windowSill: META,
  windowHeight: META,
};

export function baseModel(over: Partial<FlatModel> & Pick<FlatModel, 'vertices' | 'walls' | 'rooms'>): FlatModel {
  return {
    schemaVersion: '0.1',
    id: 'builder-synth',
    revision: 1,
    source: { site: 'manual', fetchedAt: '2026-09-12T10:00:00Z' },
    flat: {
      meta: META,
      defaults: {
        wallHeight: 2.8,
        doorHeight: 2.1,
        windowSill: 0.9,
        windowHeight: 1.5,
        meta: defaultMeta,
      },
    },
    plan: { asset: null, meta: { ...META, basis: 'assumed' } },
    openings: {},
    assets: {},
    ...over,
  };
}

export function wall(a: string, b: string, thickness = 0.2, exterior = true) {
  return { a, b, thickness, exterior, meta: META };
}

export function room(anchor: [number, number], type: FlatModel['rooms'][string]['type'] = 'living', label = 'Room') {
  return { anchor, type, label, meta: META };
}

export function door(wallId: string, at: number, width: number, extra: Record<string, unknown> = {}) {
  return { wall: wallId, kind: 'door' as const, at, width, meta: META, ...extra };
}

export function windowOpening(wallId: string, at: number, width: number, extra: Record<string, unknown> = {}) {
  return { wall: wallId, kind: 'window' as const, at, width, meta: META, ...extra };
}

/** Axis-aligned 4×3 m room: origin top-left of the plan. */
export function oneRoom() {
  return baseModel({
    vertices: {
      v1: [0, 0],
      v2: [4, 0],
      v3: [4, 3],
      v4: [0, 3],
    },
    walls: {
      wN: wall('v1', 'v2', 0.2, true),
      wE: wall('v2', 'v3', 0.2, true),
      wS: wall('v3', 'v4', 0.2, true),
      wW: wall('v4', 'v1', 0.2, true),
    },
    openings: {
      oWin: windowOpening('wN', 1.2, 1.4),
      oDoor: door('wS', 1.0, 0.9),
    },
    rooms: {
      r1: room([2, 1.5]),
    },
  });
}

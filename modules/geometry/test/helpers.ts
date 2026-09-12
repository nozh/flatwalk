import { SCHEMA_VERSION, validateFlatModel, type FlatModel, type Meta } from '@flatwalk/contract';

export const META: Meta = { provenance: 'geometry-test@0.1', basis: 'inferred' };

const defaultMeta = {
  wallHeight: META,
  doorHeight: META,
  windowSill: META,
  windowHeight: META,
};

export function baseModel(over: Partial<FlatModel> & Pick<FlatModel, 'vertices' | 'walls' | 'rooms'>): FlatModel {
  const parsed = validateFlatModel({
    schemaVersion: SCHEMA_VERSION,
    id: 'geo-synth',
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
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return parsed.data;
}

export function wall(a: string, b: string, thickness = 0.2, exterior = false) {
  return { a, b, thickness, exterior, meta: META };
}

export function room(anchor: [number, number], type: FlatModel['rooms'][string]['type'] = 'unknown', label = 'Room') {
  return { anchor, type, label, meta: META };
}

export function door(wallId: string, at: number, width: number, extra: Record<string, unknown> = {}) {
  return { wall: wallId, kind: 'door' as const, at, width, meta: META, ...extra };
}

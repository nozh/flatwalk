import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { prepareWalk } from '../src/walk-prep';

const dir = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));
const synthetic = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error('invalid test model');
  return parsed.data;
}

describe('prepareWalk', () => {
  it('builds the reference scene, finds the start and reports the geometry in words', () => {
    const prep = prepareWalk(model(reference));
    expect(prep.scene?.group.name).toBe('flat:cityexpert-54541');
    expect(prep.walk.available).toBe(true);
    if (!prep.walk.available) return;
    expect(prep.walk.start.point).toHaveLength(2);
    expect(prep.walk.segments.length).toBeGreaterThan(30);
    expect(Object.keys(prep.walk.polygons)).toHaveLength(10);
    expect(prep.walk.areas?.rooms.r1 ?? 0).toBeGreaterThan(5);
    expect(prep.diagnostics.some((line) => /10 из 10/.test(line))).toBe(true);
    expect(prep.diagnostics.join(' ')).not.toMatch(/\b[rwo]\d+\b/);
  });

  it('keeps the scene but declares the walk unavailable when Geometry Core has no start', () => {
    const prep = prepareWalk(model(synthetic));
    expect(prep.scene).not.toBeNull();
    expect(prep.walk.available).toBe(false);
    if (prep.walk.available) return;
    expect(prep.walk.reason).toMatch(/вход|старт/i);
    expect(prep.diagnostics.length).toBeGreaterThan(0);
  });
});

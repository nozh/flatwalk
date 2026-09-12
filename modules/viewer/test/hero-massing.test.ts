import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { buildMassing, exteriorRing, renderMassingSvg } from '../src/hero-massing';

const dir = dirname(fileURLToPath(import.meta.url));
const meta = { provenance: 'viewer-test@0.1', basis: 'inferred' } as const;

/** Square room, 4 x 3 m: one exterior ring, one door and one window on the south wall. */
function squareModel(): FlatModel {
  const base = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8')) as Record<string, unknown>;
  const model = {
    ...base,
    vertices: { v1: [0, 0], v2: [4, 0], v3: [4, 3], v4: [0, 3] },
    walls: {
      w1: { a: 'v1', b: 'v2', thickness: 0.2, exterior: true, meta },
      w2: { a: 'v2', b: 'v3', thickness: 0.2, exterior: true, meta },
      w3: { a: 'v3', b: 'v4', thickness: 0.2, exterior: true, meta },
      w4: { a: 'v4', b: 'v1', thickness: 0.2, exterior: true, meta },
    },
    openings: {
      o1: { wall: 'w1', kind: 'door', at: 1, width: 0.9, entrance: true, meta },
      o2: { wall: 'w2', kind: 'window', at: 1, width: 1.2, meta },
    },
    rooms: { r1: { anchor: [2, 1.5], type: 'living', label: 'Room', meta } },
  };
  const parsed = validateFlatModel(model);
  if (!parsed.success) throw new Error(`test model is not a FlatModel: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

describe('exteriorRing', () => {
  it('walks the closed loop of exterior walls', () => {
    expect(exteriorRing(squareModel())).toHaveLength(4);
  });

  it('refuses an open chain, so no floor plate is drawn for it', () => {
    const model = squareModel();
    delete (model.walls as Record<string, unknown>).w4;
    expect(exteriorRing(model)).toBeNull();
  });
});

describe('buildMassing', () => {
  it('leaves a gap at a doorway and drops a window to the sill height', () => {
    const massing = buildMassing(squareModel());
    expect(massing).not.toBeNull();
    const heights = massing!.segments.map((segment) => segment.height).sort((a, b) => a - b);
    // Two stubs beside the door, two beside the window plus the parapet, and two untouched walls.
    expect(massing!.segments).toHaveLength(7);
    expect(heights[0]).toBeCloseTo(0.9, 5);
    expect(heights.filter((height) => height === 2.8)).toHaveLength(6);
    expect(massing!.segments.filter((segment) => segment.kind === 'sill')).toHaveLength(1);
    // Nothing is drawn across the doorway itself.
    expect(massing!.segments.every((segment) => segment.corners.every(([x, y]) => !(y === 0 && x > 1 && x < 1.9)))).toBe(true);
  });

  it('reports the entrance and the plan extent', () => {
    const massing = buildMassing(squareModel())!;
    expect(massing.entrance?.[0]).toBeCloseTo(1.45, 5);
    expect(massing.entrance?.[1]).toBeCloseTo(0, 5);
    expect(massing.extent).toEqual({ width: 4, depth: 3 });
  });

  it('returns null when the model has no walls', () => {
    const model = squareModel();
    (model as { walls: Record<string, unknown> }).walls = {};
    expect(buildMassing(model)).toBeNull();
  });
});

describe('renderMassingSvg', () => {
  it('draws a floor plate, shaded faces and the entrance inside one viewBox', () => {
    const svg = renderMassingSvg(buildMassing(squareModel())!);
    expect(svg).toMatch(/^<svg class="hero-massing" viewBox="[-\d. ]+"/);
    expect(svg).toContain('class="hero-floor"');
    expect(svg).toContain('class="hero-face-top"');
    expect(svg).toContain('class="hero-face-sill"');
    expect(svg).toContain('class="hero-entrance"');
    expect(svg).toContain('role="img"');
    // Every drawn point must fall inside the computed viewBox.
    const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]+)"/)![1]!.split(' ').map(Number) as number[];
    for (const points of svg.matchAll(/points="([^"]+)"/g)) {
      for (const pair of points[1]!.split(' ')) {
        const [x, y] = pair.split(',').map(Number) as [number, number];
        expect(x).toBeGreaterThanOrEqual(vx!);
        expect(x).toBeLessThanOrEqual(vx! + vw!);
        expect(y).toBeGreaterThanOrEqual(vy!);
        expect(y).toBeLessThanOrEqual(vy! + vh!);
      }
    }
  });
});

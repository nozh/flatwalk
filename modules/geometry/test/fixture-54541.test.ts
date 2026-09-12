import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import flatModelSchema from '@flatwalk/contract/schemas/FlatModel.schema.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { adjacency, areas, collisions, faces, path, roomPolygon, startPoint, wallSide } from '../src/index.ts';
import { segmentDistance } from '../src/primitives.ts';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/54541/flat.model.json');

function loadFixture(): FlatModel {
  const parsed = validateFlatModel(JSON.parse(readFileSync(fixturePath, 'utf8')));
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return parsed.data;
}

/** Areas from fixtures/54541/README.md, axis rectangles, Σ = 105. */
const expectedAreas: Record<string, number> = {
  r1: 19.31, r2: 15.84, r3: 9.19, r4: 11.48, r5: 3.65,
  r6: 2.48, r7: 5.56, r8: 3.05, r9: 20.79, r10: 13.64,
};

const expectedWalls: Record<string, string[]> = {
  r1: ['w7', 'w11', 'w12', 'w24', 'w31', 'w34'],
  r2: ['w13', 'w14', 'w22', 'w23', 'w31', 'w33'],
  r3: ['w2', 'w21', 'w22', 'w25', 'w26', 'w27'],
  r4: ['w1', 'w18', 'w19', 'w20', 'w25'],
  r5: ['w16', 'w17', 'w19', 'w32'],
  r6: ['w15', 'w20', 'w21', 'w32', 'w33'],
  r7: ['w3', 'w4', 'w26', 'w28', 'w30'],
  r8: ['w23', 'w27', 'w29', 'w30'],
  r9: ['w5', 'w6', 'w24', 'w28', 'w29'],
  r10: ['w8', 'w9', 'w10', 'w34'],
};

const expectedDoors: Record<string, [string, string]> = {
  o1: ['r4', 'r6'],
  o2: ['r5', 'r6'],
  o3: ['r2', 'r8'],
  o4: ['r7', 'r8'],
  o5: ['r8', 'r9'],
  o6: ['r1', 'r2'],
  o7: ['r1', 'r10'],
  o8: ['r2', 'r3'],
  o20: ['r2', 'r6'],
};

function uniqueWalls(model: FlatModel, roomId: string) {
  const polygon = roomPolygon(model, roomId);
  const face = faces(model).find(item =>
    item.polygon.length === polygon!.length &&
    [...item.polygon.map(p => p.join(','))].sort().join('|') === [...polygon!.map(p => p.join(','))].sort().join('|'),
  );
  return [...new Set(face?.walls ?? [])].sort();
}

function openingCenter(model: FlatModel, openingId: string): [number, number] {
  const opening = model.openings[openingId];
  const wall = model.walls[opening.wall];
  const a = model.vertices[wall.a];
  const b = model.vertices[wall.b];
  const at = opening.at + opening.width / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * at / len, a[1] + (b[1] - a[1]) * at / len];
}

describe('GEO-07 fixture 54541', () => {
  it('loads the committed etalon through public FlatModelSchema and JSON Schema 0.1', () => {
    expect(flatModelSchema.$schema).toContain('2020-12');
    expect((flatModelSchema as { properties?: { schemaVersion?: { const?: string } } }).properties?.schemaVersion?.const).toBe('0.1');
    const model = loadFixture();
    expect(model.schemaVersion).toBe('0.1');
    expect(model.id).toBe('cityexpert-54541');
  });

  it('maps one bounded face per room with README contours and areas', () => {
    const model = loadFixture();
    const roomIds = Object.keys(model.rooms);
    expect(faces(model)).toHaveLength(roomIds.length);
    const computed = areas(model);
    expect(computed.areaComputed).toBeCloseTo(105, 2);
    for (const id of roomIds) {
      expect(roomPolygon(model, id), id).not.toBeNull();
      expect(computed.rooms[id], id).toBeCloseTo(expectedAreas[id], 2);
      expect(uniqueWalls(model, id), id).toEqual([...expectedWalls[id]].sort());
    }
  });

  it('connects rooms through interior doors and not through entrance or terrace', () => {
    const model = loadFixture();
    const edges = Object.fromEntries(adjacency(model).map(edge => [edge.opening, edge.rooms]));
    expect(Object.keys(edges).sort()).toEqual(Object.keys(expectedDoors).sort());
    for (const [id, pair] of Object.entries(expectedDoors)) {
      expect(edges[id], id).toEqual(pair);
    }
    expect(path(model, 'r2', 'r10')?.openings).toEqual(['o6', 'o7']);
    expect(adjacency(model).some(edge => edge.opening === 'o10' || edge.opening === 'o11' || edge.opening === 'o12')).toBe(false);
    const missing = Object.keys(model.rooms).filter(id => id !== 'r2' && path(model, 'r2', id) === null);
    expect(missing).toEqual([]);
  });

  it('starts in r2 facing into the flat and orients every photo wall', () => {
    const model = loadFixture();
    const start = startPoint(model);
    expect(start.point[0]).toBeCloseTo(5.2175, 3);
    expect(start.point[1]).toBeCloseTo(7.076, 3);
    expect(start.facing[1]).toBeCloseTo(-1, 5);
    const poly = roomPolygon(model, 'r2')!;
    const [x, y] = start.point;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    expect(inside).toBe(true);
    for (const [id, asset] of Object.entries(model.assets)) {
      if (asset.kind !== 'photo' || !asset.room || !asset.faces) continue;
      const side = wallSide(model, asset.faces, asset.room);
      expect(Math.hypot(side.normal[0], side.normal[1]), id).toBeCloseTo(1, 5);
    }
  });

  it('cuts collisions at interior doors and keeps the outer contour closed', () => {
    const model = loadFixture();
    const segments = collisions(model);
    const dist = (openingId: string) => {
      const opening = model.openings[openingId];
      const mid = openingCenter(model, openingId);
      const wallSegs = segments.filter(segment => segment.wall === opening.wall);
      return Math.min(...wallSegs.map(segment => segmentDistance(mid, segment.a, segment.b)));
    };
    expect(dist('o6')).toBeGreaterThan(0.4);
    expect(dist('o10')).toBeLessThan(0.2);
    expect(dist('o11')).toBeLessThan(0.1);
    expect(dist('o12')).toBeLessThan(0.2);
    expect(dist('o9')).toBeLessThan(0.1);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FlatModel } from '@flatwalk/contract';
import { describe, expect, it } from 'vitest';
import { adjacency, areas, faces, path, roomPolygon, startPoint } from '../src/index.ts';

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/54541/flat.model.json');

function loadFixture(): FlatModel {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as FlatModel;
}

describe('GEO-07 fixture 54541', () => {
  it('maps one bounded face per room and a connected door graph', () => {
    const model = loadFixture();
    const roomIds = Object.keys(model.rooms);
    const bounded = faces(model);
    expect(bounded).toHaveLength(roomIds.length);
    for (const id of roomIds) {
      expect(roomPolygon(model, id), id).not.toBeNull();
    }
    const computed = areas(model);
    expect(computed.areaComputed).toBeGreaterThan(80);
    expect(computed.areaComputed).toBeLessThan(130);

    const start = startPoint(model);
    expect(start.facing[1]).toBeLessThan(-0.9);

    const entranceRoom = roomIds.find(id => {
      const poly = roomPolygon(model, id)!;
      const [x, y] = start.point;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
      return inside;
    });
    expect(entranceRoom).toBeTruthy();

    const missing = roomIds.filter(id => id !== entranceRoom && path(model, entranceRoom!, id) === null);
    expect(missing).toEqual([]);
    expect(adjacency(model).length).toBeGreaterThanOrEqual(roomIds.length - 1);
  });
});

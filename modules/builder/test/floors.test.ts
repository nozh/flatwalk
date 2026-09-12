import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { roomPolygon } from '@flatwalk/geometry';
import { build, buildScene, type BuilderGeometry } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

const fixture = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/54541/flat.model.json');

const stubRect: BuilderGeometry = {
  roomPolygon: (model, roomId) => {
    const room = model.rooms[roomId];
    if (!room) return null;
    const xs = Object.values(model.vertices).map(point => point[0]);
    const ys = Object.values(model.vertices).map(point => point[1]);
    return [
      [Math.min(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.min(...ys)],
      [Math.max(...xs), Math.max(...ys)],
      [Math.min(...xs), Math.max(...ys)],
    ];
  },
};

describe('floors with an explicit test stub (not Geometry Core)', () => {
  it('puts floor at y=0 covering the plan rectangle and ceiling at wallHeight', () => {
    const group = build(oneRoom(), { geometry: stubRect });
    const floor = group.getObjectByName('floor:r1') as Mesh;
    const ceiling = group.getObjectByName('ceiling:r1') as Mesh;
    expect(floor).toBeTruthy();
    expect(ceiling.position.y).toBeCloseTo(2.8, 5);
    const box = new Box3().setFromObject(floor);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(4, 2);
    expect(size.z).toBeCloseTo(3, 2);
    expect(box.min.y).toBeCloseTo(0, 2);
  });
});

describe('floors via Geometry Core', () => {
  it('uses roomPolygon of the synthetic room, not a builder-owned boundary', () => {
    const model = oneRoom();
    const polygon = roomPolygon(model, 'r1');
    expect(polygon).not.toBeNull();
    const group = build(model);
    const floor = group.getObjectByName('floor:r1') as Mesh;
    const box = new Box3().setFromObject(floor);
    const size = box.getSize(new Vector3());
    expect(size.x).toBeCloseTo(4, 2);
    expect(size.z).toBeCloseTo(3, 2);
  });

  it('builds floors and ceilings for every room of 54541', () => {
    const model = JSON.parse(readFileSync(fixture, 'utf8'));
    const { group, warnings } = buildScene(model);
    const roomIds = Object.keys(model.rooms);
    for (const id of roomIds) {
      expect(group.getObjectByName(`floor:${id}`), `floor:${id}`).toBeTruthy();
      expect(group.getObjectByName(`ceiling:${id}`), `ceiling:${id}`).toBeTruthy();
    }
    expect(warnings).toEqual([]);
  });
});

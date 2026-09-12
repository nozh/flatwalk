import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { build, snapshot } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

const fixture = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/54541/flat.model.json');

describe('BLD-01 snapshot', () => {
  it('is identical for two builds of the same synthetic model', () => {
    const model = oneRoom();
    const a = snapshot(build(model, { floors: false }));
    const b = snapshot(build(model, { floors: false }));
    expect(a).toEqual(b);
    expect(a.every(row => row.name)).toBe(true);
    const doorLeft = a.find(row => row.name === 'wall:wS:left:oDoor');
    expect(doorLeft?.size[1]).toBe(2.8);
    expect(doorLeft?.position[2]).toBe(3);
  });
});

describe('BLD-01 / BLD-04 fixture 54541', () => {
  it('builds without throwing and yields a stable snapshot of unique mesh names', () => {
    const model = JSON.parse(readFileSync(fixture, 'utf8'));
    const first = build(model, { floors: false });
    const second = build(model, { floors: false });
    const snap = snapshot(first);
    expect(snapshot(second)).toEqual(snap);
    const names = snap.map(row => row.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some(name => name.startsWith('wall:'))).toBe(true);
    expect(names.some(name => name.includes(':lintel:'))).toBe(true);
    const box = new Box3();
    first.traverse(object => {
      if (object instanceof Mesh) box.expandByObject(object);
    });
    const size = box.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(10);
    expect(size.z).toBeGreaterThan(8);
    expect(size.y).toBeGreaterThan(2.5);
  });
});

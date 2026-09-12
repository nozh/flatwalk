import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FlatModel } from '@flatwalk/contract';
import { overlayMarks } from '../src/overlay-marks.ts';
import { oneRoom } from './helpers.ts';

const fixture = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/54541/flat.model.json');

describe('overlayMarks — meters to pixels from the accepted model', () => {
  it('maps etalon v1 onto plan.png pixels using the model pxPerMeter, not 470×393', () => {
    const model = JSON.parse(readFileSync(fixture, 'utf8')) as FlatModel;
    expect(model.plan.pxPerMeter).toBe(66.123);
    const marks = overlayMarks(model, model.plan.pxPerMeter!);
    const wall = marks.find(mark => mark.kind === 'wall' && mark.id === 'w1');
    expect(wall).toMatchObject({ kind: 'wall', id: 'w1' });
    if (wall?.kind !== 'wall') throw new Error('expected wall w1');
    expect(wall.x1).toBeCloseTo(9, 0);
    expect(wall.y1).toBeCloseTo(94, 0);
    expect(wall.x2).toBeCloseTo(254.5, 0);
    expect(wall.y2).toBeCloseTo(94, 0);
    expect(wall.thickness).toBeCloseTo(0.26 * 66.123, 1);
  });

  it('places openings from wall.a + at and room anchors from the model graph', () => {
    const model = oneRoom();
    const marks = overlayMarks(model, 10);
    const door = marks.find(mark => mark.kind === 'opening' && mark.id === 'oDoor');
    const room = marks.find(mark => mark.kind === 'room' && mark.id === 'r1');
    expect(door).toMatchObject({ kind: 'opening', id: 'oDoor', openingKind: 'door' });
    if (door?.kind !== 'opening') throw new Error('expected door');
    // wS a=(4,3) → b=(0,3); at=1, width=0.9 → (3,3)…(2.1,3) at 10 px/m
    expect(door.x1).toBeCloseTo(30, 5);
    expect(door.y1).toBeCloseTo(30, 5);
    expect(door.x2).toBeCloseTo(21, 5);
    expect(door.y2).toBeCloseTo(30, 5);
    expect(room).toMatchObject({ kind: 'room', id: 'r1', x: 20, y: 15 });
  });

  it('lists live IDs from the model dictionaries, not a second geometry source', () => {
    const model = JSON.parse(readFileSync(fixture, 'utf8')) as FlatModel;
    const marks = overlayMarks(model, model.plan.pxPerMeter!);
    const ids = (kind: 'wall' | 'opening' | 'room') =>
      marks.filter(mark => mark.kind === kind).map(mark => mark.id);
    expect(ids('wall').sort()).toEqual(Object.keys(model.walls).sort());
    expect(ids('opening').sort()).toEqual(Object.keys(model.openings).sort());
    expect(ids('room').sort()).toEqual(Object.keys(model.rooms).sort());
  });
});

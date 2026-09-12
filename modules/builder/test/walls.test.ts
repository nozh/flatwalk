import { describe, expect, it } from 'vitest';
import { Mesh, BoxGeometry } from 'three';
import { build } from '../src/index.ts';
import { oneRoom, windowOpening, baseModel, wall, room, door } from './helpers.ts';

function meshByName(group: ReturnType<typeof build>, name: string) {
  const found = group.getObjectByName(name);
  expect(found, name).toBeTruthy();
  return found as Mesh;
}

function boxSize(mesh: Mesh) {
  const geometry = mesh.geometry as BoxGeometry;
  geometry.computeBoundingBox();
  return {
    w: geometry.parameters.width,
    h: geometry.parameters.height,
    d: geometry.parameters.depth,
  };
}

describe('plan → three.js coordinates', () => {
  it('places a north wall (plan y = 0) at world z = 0, not -y', () => {
    const group = build(oneRoom(), { floors: false });
    const left = meshByName(group, 'wall:wN:left:oWin');
    expect(left.position.z).toBeCloseTo(0, 5);
    expect(left.position.x).toBeCloseTo(0.6, 5);
    expect(left.position.y).toBeCloseTo(1.4, 5);
  });

  it('places a south wall at plan y as world z', () => {
    const group = build(oneRoom(), { floors: false });
    const left = meshByName(group, 'wall:wS:left:oDoor');
    expect(left.position.z).toBeCloseTo(3, 5);
  });
});

describe('BLD-02 wall boxes and openings', () => {
  it('splits a window into left, sill, lintel, right with defaults 0.9 / 1.5 / 2.8', () => {
    const group = build(oneRoom(), { floors: false });
    const left = boxSize(meshByName(group, 'wall:wN:left:oWin'));
    const right = boxSize(meshByName(group, 'wall:wN:right:oWin'));
    const sill = boxSize(meshByName(group, 'wall:wN:sill:oWin'));
    const lintel = boxSize(meshByName(group, 'wall:wN:lintel:oWin'));
    const glass = boxSize(meshByName(group, 'wall:wN:glass:oWin'));
    expect(left.w).toBeCloseTo(1.2, 5);
    expect(left.h).toBeCloseTo(2.8, 5);
    expect(left.d).toBeCloseTo(0.2, 5);
    expect(right.w).toBeCloseTo(1.4, 5);
    expect(sill.w).toBeCloseTo(1.4, 5);
    expect(sill.h).toBeCloseTo(0.9, 5);
    expect(lintel.h).toBeCloseTo(0.4, 5);
    expect(glass.w).toBeCloseTo(1.4, 5);
    expect(glass.h).toBeCloseTo(1.5, 5);
  });

  it('splits a passable door into left, lintel, right without a sill or leaf', () => {
    const group = build(oneRoom(), { floors: false });
    const left = boxSize(meshByName(group, 'wall:wS:left:oDoor'));
    const lintel = boxSize(meshByName(group, 'wall:wS:lintel:oDoor'));
    expect(left.w).toBeCloseTo(1.0, 5);
    expect(lintel.h).toBeCloseTo(0.7, 5);
    expect(group.getObjectByName('wall:wS:sill:oDoor')).toBeUndefined();
    expect(group.getObjectByName('wall:wS:glass:oDoor')).toBeUndefined();
  });

  it('keeps unique names for two windows on one wall', () => {
    const model = baseModel({
      vertices: { v1: [0, 0], v2: [8, 0], v3: [8, 3], v4: [0, 3] },
      walls: {
        wN: wall('v1', 'v2'),
        wE: wall('v2', 'v3'),
        wS: wall('v3', 'v4'),
        wW: wall('v4', 'v1'),
      },
      openings: {
        oA: windowOpening('wN', 1, 1),
        oB: windowOpening('wN', 4, 1.5),
      },
      rooms: { r1: room([4, 1.5]) },
    });
    const group = build(model, { floors: false });
    const names = group.children.map(child => child.name).filter(name => name.startsWith('wall:wN'));
    expect(names.sort()).toEqual([
      'wall:wN:between:oA:oB',
      'wall:wN:glass:oA',
      'wall:wN:glass:oB',
      'wall:wN:left:oA',
      'wall:wN:lintel:oA',
      'wall:wN:lintel:oB',
      'wall:wN:right:oB',
      'wall:wN:sill:oA',
      'wall:wN:sill:oB',
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(boxSize(meshByName(group, 'wall:wN:left:oA')).w).toBeCloseTo(1, 5);
    expect(boxSize(meshByName(group, 'wall:wN:between:oA:oB')).w).toBeCloseTo(2, 5);
    expect(boxSize(meshByName(group, 'wall:wN:right:oB')).w).toBeCloseTo(2.5, 5);
  });

  it('glazes an impassable door for the full door height', () => {
    const model = oneRoom();
    model.openings.oDoor = door('wS', 1.0, 0.9, { passable: false });
    const group = build(model, { floors: false });
    const glass = boxSize(meshByName(group, 'wall:wS:glass:oDoor'));
    expect(glass.h).toBeCloseTo(2.1, 5);
  });
});

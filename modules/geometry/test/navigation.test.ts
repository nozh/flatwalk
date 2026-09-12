import { describe, expect, it } from 'vitest';
import { GeometryError, adjacency, path, startPoint, wallSide } from '../src/index.ts';
import { baseModel, door, room, wall } from './helpers.ts';

function twoRooms(openings = {}) {
  return baseModel({
    vertices: {
      v1: [0, 0], v2: [4, 0], v3: [8, 0], v4: [8, 3], v5: [4, 3], v6: [0, 3],
    },
    walls: {
      w12: wall('v1', 'v2', 0.2, true),
      w23: wall('v2', 'v3', 0.2, true),
      w34: wall('v3', 'v4', 0.2, true),
      w45: wall('v4', 'v5', 0.2, true),
      w56: wall('v5', 'v6', 0.2, true),
      w61: wall('v6', 'v1', 0.2, true),
      w25: wall('v2', 'v5', 0.2, false),
    },
    openings,
    rooms: {
      left: room([2, 1.5], 'living', 'Left'),
      right: room([6, 1.5], 'bedroom', 'Right'),
    },
  });
}

function threeRooms() {
  return baseModel({
    vertices: {
      a: [0, 0], b: [4, 0], c: [8, 0], d: [12, 0],
      h: [0, 3], g: [4, 3], f: [8, 3], e: [12, 3],
    },
    walls: {
      ab: wall('a', 'b', 0.2, true),
      bc: wall('b', 'c', 0.2, true),
      cd: wall('c', 'd', 0.2, true),
      de: wall('d', 'e', 0.2, true),
      ef: wall('e', 'f', 0.2, true),
      fg: wall('f', 'g', 0.2, true),
      gh: wall('g', 'h', 0.2, true),
      ha: wall('h', 'a', 0.2, true),
      bg: wall('b', 'g', 0.2, false),
      cf: wall('c', 'f', 0.2, false),
    },
    openings: {
      d1: door('bg', 1, 1),
      d2: door('cf', 1, 1),
    },
    rooms: {
      left: room([2, 1.5], 'living'),
      mid: room([6, 1.5], 'corridor'),
      right: room([10, 1.5], 'bedroom'),
    },
  });
}

describe('GEO-03 adjacency and path', () => {
  it('connects two rooms through a passable door', () => {
    const model = twoRooms({ d1: door('w25', 1, 1) });
    expect(adjacency(model)).toEqual([{ opening: 'd1', rooms: ['left', 'right'] }]);
    expect(path(model, 'left', 'right')).toEqual({ rooms: ['left', 'right'], openings: ['d1'] });
  });

  it('ignores windows and passable:false, including a closed passage', () => {
    const model = twoRooms({
      w: { wall: 'w25', kind: 'window' as const, at: 0.2, width: 0.5, meta: { provenance: 'geometry-test@0.1', basis: 'inferred' } },
      closed: door('w25', 1, 1, { passable: false }),
    });
    expect(adjacency(model)).toEqual([]);
    expect(path(model, 'left', 'right')).toBeNull();
  });

  it('walks a room with two doors and reports an unreachable room', () => {
    const model = threeRooms();
    expect(path(model, 'left', 'right')?.rooms).toEqual(['left', 'mid', 'right']);
    const isolated = structuredClone(model);
    isolated.openings = { d1: door('bg', 1, 1) };
    expect(path(isolated, 'left', 'mid')?.openings).toEqual(['d1']);
    expect(path(isolated, 'left', 'right')).toBeNull();
  });

  it('does not treat the entrance as an adjacency edge', () => {
    const model = twoRooms({
      d1: door('w25', 1, 1),
      enter: door('w61', 1, 1, { entrance: true }),
    });
    expect(adjacency(model).map(edge => edge.opening)).toEqual(['d1']);
  });
});

describe('GEO-05 startPoint and wallSide', () => {
  it('starts 1 m inward from the entrance and looks into the room', () => {
    const model = twoRooms({
      d1: door('w25', 1, 1),
      enter: door('w61', 1, 1, { entrance: true }),
    });
    const start = startPoint(model);
    expect(start.point[0]).toBeCloseTo(1, 5);
    expect(start.point[1]).toBeCloseTo(1.5, 5);
    expect(start.facing[0]).toBeGreaterThan(0.9);
    expect(Math.abs(start.facing[1])).toBeLessThan(0.1);
    const side = wallSide(model, 'w25', 'left');
    expect(side.normal[0]).toBeLessThan(-0.9);
    expect(() => wallSide(model, 'w34', 'left')).toThrow(GeometryError);
  });

  it('rejects a start that lands outside the room', () => {
    const model = baseModel({
      vertices: { a: [0, 0], b: [4, 0], c: [4, 0.6], d: [0, 0.6] },
      walls: {
        ab: wall('a', 'b', 0.1, true),
        bc: wall('b', 'c', 0.1, true),
        cd: wall('c', 'd', 0.1, true),
        da: wall('d', 'a', 0.1, true),
      },
      openings: { enter: door('ab', 1.5, 1, { entrance: true }) },
      rooms: { slim: room([2, 0.3], 'corridor') },
    });
    expect(() => startPoint(model)).toThrow(GeometryError);
    try {
      startPoint(model);
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-start' });
    }
  });
});

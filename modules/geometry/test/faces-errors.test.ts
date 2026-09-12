import { describe, expect, it } from 'vitest';
import { GeometryError, areas, faces, roomPolygon } from '../src/index.ts';
import { baseModel, room, wall } from './helpers.ts';

/** Internal wall meets an unsplit 6 m base at a T-vertex. Two 3×4 m rooms, 12 m² each. */
function teeJunction() {
  return baseModel({
    vertices: {
      v1: [0, 0],
      v2: [6, 0],
      v3: [6, 4],
      v4: [0, 4],
      t0: [3, 0],
      t1: [3, 4],
    },
    walls: {
      base: wall('v1', 'v2', 0.2, true),
      right: wall('v2', 'v3', 0.2, true),
      top: wall('v3', 'v4', 0.2, true),
      left: wall('v4', 'v1', 0.2, true),
      stem: wall('t0', 't1', 0.2, false),
    },
    rooms: {
      left: room([1.5, 2], 'living', 'Left'),
      right: room([4.5, 2], 'bedroom', 'Right'),
    },
  });
}

describe('GEO-01 T-junction', () => {
  it('splits the unsplit base wall and still yields 12 m² rooms', () => {
    const model = teeJunction();
    expect(faces(model)).toHaveLength(2);
    expect(areas(model).rooms.left).toBeCloseTo(12, 5);
    expect(areas(model).rooms.right).toBeCloseTo(12, 5);
    const left = roomPolygon(model, 'left');
    expect(left?.some(p => p[0] === 3 && p[1] === 0)).toBe(true);
  });
});

describe('GEO-02 invalid geometry', () => {
  it('throws nonplanar when walls cross away from a vertex', () => {
    const model = baseModel({
      vertices: { a: [0, 0], b: [4, 4], c: [0, 4], d: [4, 0] },
      walls: {
        ab: wall('a', 'b'),
        cd: wall('c', 'd'),
      },
      rooms: { r: room([2, 1]) },
    });
    expect(() => faces(model)).toThrow(GeometryError);
    try {
      faces(model);
    } catch (error) {
      expect(error).toMatchObject({ code: 'nonplanar' });
    }
  });

  it('returns null for an anchor on a wall or outside, without inventing a polygon', () => {
    const model = baseModel({
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
      rooms: {
        left: room([2, 1.5]),
        onWall: room([4, 1.5]),
        outside: room([-1, -1]),
      },
    });
    expect(roomPolygon(model, 'left')).not.toBeNull();
    expect(roomPolygon(model, 'onWall')).toBeNull();
    expect(roomPolygon(model, 'outside')).toBeNull();
  });

  it('throws ambiguous-mapping when two anchors share one face', () => {
    const model = baseModel({
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
      rooms: {
        a: room([2, 1.5]),
        b: room([1, 1]),
      },
    });
    expect(() => roomPolygon(model, 'a')).toThrow(GeometryError);
    try {
      roomPolygon(model, 'a');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ambiguous-mapping' });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { adjacency, collisions, roomPolygon } from '../src/index.ts';
import { baseModel, door, room, wall } from './helpers.ts';
import { segmentDistance } from '../src/primitives.ts';

function twoRooms(sharedThickness: number, openings = {}) {
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
      w25: wall('v2', 'v5', sharedThickness, false),
    },
    openings,
    rooms: {
      left: room([2, 1.5], 'living', 'Left'),
      right: room([6, 1.5], 'bedroom', 'Right'),
    },
  });
}

describe('GEO-04 collisions', () => {
  it('offsets leftover wall pieces by thickness/2 and keeps a door gap', () => {
    const model = twoRooms(0.4, { d1: door('w25', 1, 1) });
    const segments = collisions(model).filter(segment => segment.wall === 'w25');
    expect(segments.length).toBeGreaterThanOrEqual(2);
    const doorCenter: [number, number] = [4, 1.5];
    const solid: [number, number] = [4, 0.4];
    const doorClearance = Math.min(...segments.map(segment => segmentDistance(doorCenter, segment.a, segment.b)));
    const solidClearance = Math.min(...segments.map(segment => segmentDistance(solid, segment.a, segment.b)));
    expect(doorClearance).toBeGreaterThan(0.15);
    expect(solidClearance).toBeLessThan(0.22);
    expect(solidClearance).toBeGreaterThan(0.05);
  });

  it('does not cut the outer contour at the entrance', () => {
    const model = twoRooms(0.2, { enter: door('w61', 1, 1, { entrance: true }) });
    const outer = collisions(model).filter(segment => segment.wall === 'w61');
    const doorCenter: [number, number] = [0, 1.5];
    const clearance = Math.min(...outer.map(segment => segmentDistance(doorCenter, segment.a, segment.b)));
    expect(clearance).toBeLessThan(0.15);
  });

  it('uses each wall thickness independently', () => {
    const thin = collisions(twoRooms(0.2)).filter(segment => segment.wall === 'w25');
    const thick = collisions(twoRooms(0.6)).filter(segment => segment.wall === 'w25');
    const sample: [number, number] = [4, 1.5];
    const dist = (items: typeof thin) => Math.min(...items.map(segment => segmentDistance(sample, segment.a, segment.b)));
    expect(dist(thick)).toBeGreaterThan(dist(thin));
  });
});

describe('GEO-06 cache invalidation', () => {
  it('does not keep a polygon after the anchor moves outside', () => {
    const model = twoRooms(0.2, { d1: door('w25', 1, 1) });
    expect(roomPolygon(model, 'left')).not.toBeNull();
    const moved = structuredClone(model);
    moved.rooms.left.anchor = [-2, -2];
    expect(roomPolygon(moved, 'left')).toBeNull();
    const thicker = structuredClone(model);
    thicker.walls.w25.thickness = 0.8;
    const before = collisions(model).filter(s => s.wall === 'w25')[0];
    const after = collisions(thicker).filter(s => s.wall === 'w25')[0];
    expect(after.a[0]).not.toBeCloseTo(before.a[0], 5);
    const closed = structuredClone(model);
    const opening = closed.openings.d1;
    if (opening.kind !== 'door') throw new Error('expected door');
    opening.passable = false;
    expect(adjacency(closed)).toEqual([]);
    expect(adjacency(model)).toHaveLength(1);
  });
});

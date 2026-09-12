import { describe, expect, it } from 'vitest';
import { areas, faces, roomPolygon } from '../src/index.ts';
import { baseModel, room, wall } from './helpers.ts';

/** Two 4×3 m rooms sharing the wall at x=4. Areas 12 m² each by shoelace on axes. */
function twoRooms() {
  return baseModel({
    vertices: {
      v1: [0, 0],
      v2: [4, 0],
      v3: [8, 0],
      v4: [8, 3],
      v5: [4, 3],
      v6: [0, 3],
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
      left: room([2, 1.5], 'living', 'Left'),
      right: room([6, 1.5], 'bedroom', 'Right'),
    },
  });
}

describe('GEO-01 two rooms with a shared wall', () => {
  it('finds two bounded faces and axis areas 12 m²', () => {
    const model = twoRooms();
    const bounded = faces(model);
    expect(bounded).toHaveLength(2);
    const left = roomPolygon(model, 'left');
    const right = roomPolygon(model, 'right');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    const result = areas(model);
    expect(result.rooms.left).toBeCloseTo(12, 5);
    expect(result.rooms.right).toBeCloseTo(12, 5);
    expect(result.areaComputed).toBeCloseTo(24, 5);
  });
});

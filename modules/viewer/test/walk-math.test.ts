import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { collisions, roomPolygon, startPoint } from '@flatwalk/geometry';
import { PLAYER_RADIUS, canStand, movePlayer, roomAt, roomPolygons, type Point } from '../src/walk-math';

const dir = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error('invalid test model');
  return parsed.data;
}

const flat = model(reference);
const segments = collisions(flat);
const polygons = roomPolygons(flat, roomPolygon);
const start = startPoint(flat);

/** Walks straight towards a target in 7 cm steps and reports where the player ends up. */
function walkTowards(from: Point, target: Point, steps = 80): Point {
  let player = from;
  for (let i = 0; i < steps; i++) {
    const dx = target[0] - player[0];
    const dy = target[1] - player[1];
    const len = Math.hypot(dx, dy);
    if (len < 0.01) break;
    player = movePlayer(player, [(dx / len) * 0.07, (dy / len) * 0.07], segments, PLAYER_RADIUS);
  }
  return player;
}

/** Centre of an opening and the point `depth` metres beyond it along the wall normal that points to `sign`. */
function acrossOpening(id: string, depth: number, sign: 1 | -1): { centre: Point; beyond: Point } {
  const opening = flat.openings[id];
  const wall = flat.walls[opening.wall];
  const a = flat.vertices[wall.a];
  const b = flat.vertices[wall.b];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const at = opening.at + opening.width / 2;
  const centre: Point = [a[0] + ux * at, a[1] + uy * at];
  const normal: Point = [-uy * sign, ux * sign];
  return { centre, beyond: [centre[0] + normal[0] * depth, centre[1] + normal[1] * depth] };
}

describe('walk-math on the 54541 reference', () => {
  it('uses the player radius once: the start point from Geometry Core is standable', () => {
    expect(PLAYER_RADIUS).toBe(0.25);
    expect(canStand(start.point, segments, PLAYER_RADIUS)).toBe(true);
    expect(roomAt(start.point, polygons)).toBe('r2');
  });

  it('walks through the interior arch o6 from the dining room into the living room', () => {
    const { beyond } = acrossOpening('o6', 0.8, 1);
    const side = roomAt(beyond, polygons) === 'r1' ? beyond : acrossOpening('o6', 0.8, -1).beyond;
    expect(roomAt(side, polygons)).toBe('r1');
    const end = walkTowards(start.point, side, 120);
    expect(roomAt(end, polygons)).toBe('r1');
  });

  it('walks through the open passage o8 into the kitchen but not through the window o9 next to it', () => {
    const passage = acrossOpening('o8', 0.8, 1);
    const target = roomAt(passage.beyond, polygons) === 'r3' ? passage.beyond : acrossOpening('o8', 0.8, -1).beyond;
    const from: Point = [passage.centre[0], start.point[1] - 0.3];
    expect(roomAt(from, polygons)).toBe('r2');
    expect(roomAt(walkTowards(from, target, 80), polygons)).toBe('r3');

    const window = acrossOpening('o9', 0.8, 1);
    const wrongSide = roomAt(window.beyond, polygons) === 'r3' ? window.beyond : acrossOpening('o9', 0.8, -1).beyond;
    const fromBelow: Point = [window.centre[0], from[1]];
    const end = walkTowards(fromBelow, wrongSide, 80);
    expect(roomAt(end, polygons)).toBe('r2');
    expect(Math.hypot(end[0] - wrongSide[0], end[1] - wrongSide[1])).toBeGreaterThan(0.5);
  });

  it('cannot leave through the entrance o10 or the glazed terrace doors o11 and o12', () => {
    for (const id of ['o10', 'o11', 'o12'] as const) {
      const one = acrossOpening(id, 0.9, 1);
      const inside = roomAt(one.beyond, polygons) ? one : acrossOpening(id, 0.9, -1);
      const outside: Point = [one.centre[0] * 2 - inside.beyond[0], one.centre[1] * 2 - inside.beyond[1]];
      const room = roomAt(inside.beyond, polygons);
      expect(room, id).not.toBeNull();
      const end = walkTowards(inside.beyond, outside, 60);
      expect(roomAt(end, polygons), id).toBe(room);
      expect(Math.hypot(end[0] - outside[0], end[1] - outside[1]), id).toBeGreaterThan(0.4);
    }
  });

  it('never leaves the flat on a long pseudo-random walk', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let player = start.point;
    let angle = 0;
    for (let i = 0; i < 3000; i++) {
      if (i % 25 === 0) angle = random() * Math.PI * 2;
      player = movePlayer(player, [Math.cos(angle) * 0.07, Math.sin(angle) * 0.07], segments, PLAYER_RADIUS);
      expect(roomAt(player, polygons)).not.toBeNull();
      expect(canStand(player, segments, PLAYER_RADIUS)).toBe(true);
    }
  });
});

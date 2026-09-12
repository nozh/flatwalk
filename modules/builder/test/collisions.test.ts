import { Box3, Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { collisions } from '@flatwalk/geometry';
import { build } from '../src/index.ts';
import { door, twoRooms, windowOpening } from './helpers.ts';

function segmentDistance(p: [number, number], a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function walkingWallBoxes(group: ReturnType<typeof build>, wallId: string) {
  const meshes: Mesh[] = [];
  group.traverse(object => {
    if (!(object instanceof Mesh) || !object.name.startsWith(`wall:${wallId}`)) return;
    if (object.name.includes(':glass:')) return;
    const box = new Box3().setFromObject(object);
    if (box.min.y < 1.8 && box.max.y > 0.05) meshes.push(object);
  });
  return meshes;
}

describe('BLD-02 openings vs Geometry Core collisions', () => {
  it('leaves a walkable gap where collisions cut an interior door', () => {
    const model = twoRooms({ d1: door('w25', 1, 1) });
    const group = build(model);
    const doorCenter: [number, number] = [4, 1.5];
    const segments = collisions(model).filter(segment => segment.wall === 'w25');
    const clearance = Math.min(...segments.map(segment => segmentDistance(doorCenter, segment.a, segment.b)));
    expect(clearance).toBeGreaterThan(0.15);

    for (const mesh of walkingWallBoxes(group, 'w25')) {
      const box = new Box3().setFromObject(mesh);
      const xz = new Vector3(doorCenter[0], 1, doorCenter[1]);
      expect(box.containsPoint(xz), mesh.name).toBe(false);
    }
    expect(group.getObjectByName('wall:w25:lintel:d1')).toBeTruthy();
    expect(group.getObjectByName('wall:w25:left:d1')).toBeTruthy();
    expect(group.getObjectByName('wall:w25:right:d1')).toBeTruthy();
  });

  it('keeps a window blocked in collisions and in the walking-height wall', () => {
    const model = twoRooms({ w1: windowOpening('w25', 1, 1) });
    const group = build(model);
    const center: [number, number] = [4, 1.5];
    const segments = collisions(model).filter(segment => segment.wall === 'w25');
    const clearance = Math.min(...segments.map(segment => segmentDistance(center, segment.a, segment.b)));
    expect(clearance).toBeCloseTo(0.1, 5);
    const sill = group.getObjectByName('wall:w25:sill:w1') as Mesh;
    expect(sill).toBeTruthy();
    const box = new Box3().setFromObject(sill);
    expect(box.containsPoint(new Vector3(4, 0.45, 1.5))).toBe(true);
  });
});

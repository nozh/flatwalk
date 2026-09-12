import type { FlatModel } from '@flatwalk/contract';
import { GeometryError, roomPolygon as geometryRoomPolygon } from '@flatwalk/geometry';
import * as THREE from 'three';
import { floorMaterial, type BuilderMaterials } from './materials.ts';

export type Point = readonly [number, number];

/** Geometry Core surface used for floors and ceilings. Test stubs must match this shape. */
export type BuilderGeometry = {
  roomPolygon: (model: FlatModel, roomId: string) => Point[] | null;
};

export const defaultGeometry: BuilderGeometry = {
  roomPolygon: geometryRoomPolygon,
};

export function buildFloorsAndCeilings(
  model: FlatModel,
  materials: BuilderMaterials,
  parent: THREE.Group,
  geometry: BuilderGeometry,
  warnings: string[],
) {
  const wallHeight = model.flat.defaults.wallHeight;
  for (const roomId of Object.keys(model.rooms).sort()) {
    let polygon: Point[] | null = null;
    try {
      polygon = geometry.roomPolygon(model, roomId);
    } catch (error) {
      warnings.push(geometryWarning(roomId, error));
      continue;
    }
    if (!polygon || polygon.length < 3) {
      warnings.push(`rooms.${roomId}: no polygon from Geometry Core`);
      continue;
    }
    // Shape in XY with y flipped, then -90° about X → world (x, 0, planY), normal +Y.
    const shape = new THREE.Shape(polygon.map(point => new THREE.Vector2(point[0], -point[1])));
    const floorGeometry = new THREE.ShapeGeometry(shape);
    const ceilingGeometry = floorGeometry.clone();
    const room = model.rooms[roomId]!;
    const floor = new THREE.Mesh(floorGeometry, floorMaterial(materials, room.dressing?.floor));
    floor.name = `floor:${roomId}`;
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    parent.add(floor);

    const ceiling = new THREE.Mesh(ceilingGeometry, materials.ceiling);
    ceiling.name = `ceiling:${roomId}`;
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = wallHeight;
    parent.add(ceiling);

    const cx = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length;
    const cz = polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length;
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.12), materials.label);
    label.name = `label:${roomId}`;
    label.position.set(cx, 1.5, cz);
    parent.add(label);
  }
}

function geometryWarning(roomId: string, error: unknown) {
  if (error instanceof GeometryError) {
    return `rooms.${roomId}: Geometry Core ${error.code}: ${error.message}`;
  }
  return `rooms.${roomId}: ${error instanceof Error ? error.message : String(error)}`;
}

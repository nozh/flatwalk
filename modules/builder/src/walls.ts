import type { FlatModel, Opening } from '@flatwalk/contract';
import * as THREE from 'three';
import { distance } from './coords.ts';
import type { BuilderMaterials } from './materials.ts';

const MIN = 0.001;

type WallFrame = {
  wallId: string;
  a: readonly [number, number];
  ux: number;
  uz: number;
  angle: number;
  thickness: number;
  len: number;
};

export function buildWalls(model: FlatModel, materials: BuilderMaterials, parent: THREE.Group) {
  const wallHeight = model.flat.defaults.wallHeight;
  const defaults = model.flat.defaults;
  for (const wallId of Object.keys(model.walls).sort()) {
    const wall = model.walls[wallId]!;
    const a = model.vertices[wall.a];
    const b = model.vertices[wall.b];
    if (!a || !b) continue;
    const len = distance(a, b);
    if (len < MIN) continue;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    const frame: WallFrame = {
      wallId,
      a,
      ux,
      uz,
      angle: -Math.atan2(uz, ux),
      thickness: wall.thickness,
      len,
    };
    const openings = Object.entries(model.openings)
      .filter(([, opening]) => opening.wall === wallId)
      .sort((left, right) => left[1].at - right[1].at || left[0].localeCompare(right[0]));

    if (openings.length === 0) {
      addBox(parent, frame, 0, len, 0, wallHeight, materials.wall, `wall:${wallId}`);
      continue;
    }

    let cursor = 0;
    openings.forEach(([openingId, opening], index) => {
      const start = clamp(opening.at, 0, len);
      const end = clamp(opening.at + opening.width, 0, len);
      addBox(parent, frame, cursor, start, 0, wallHeight, materials.wall, spanName(wallId, openings, index, 'before'));
      addOpeningPieces(parent, frame, openingId, opening, start, end, wallHeight, defaults, materials);
      cursor = Math.max(cursor, end);
      if (index === openings.length - 1) {
        addBox(parent, frame, cursor, len, 0, wallHeight, materials.wall, spanName(wallId, openings, index, 'after'));
      }
    });
  }
}

function spanName(wallId: string, openings: [string, Opening][], index: number, side: 'before' | 'after') {
  if (side === 'before') {
    const id = openings[index]![0];
    if (index === 0) return `wall:${wallId}:left:${id}`;
    return `wall:${wallId}:between:${openings[index - 1]![0]}:${id}`;
  }
  return `wall:${wallId}:right:${openings[index]![0]}`;
}

function addOpeningPieces(
  parent: THREE.Group,
  frame: WallFrame,
  openingId: string,
  opening: Opening,
  start: number,
  end: number,
  wallHeight: number,
  defaults: FlatModel['flat']['defaults'],
  materials: BuilderMaterials,
) {
  const sill = opening.kind === 'window' ? (opening.sill ?? defaults.windowSill) : 0;
  const openingHeight =
    opening.height ?? (opening.kind === 'window' ? defaults.windowHeight : defaults.doorHeight);
  const top = Math.min(sill + openingHeight, wallHeight);
  const glass = opening.kind === 'window' || (opening.kind === 'door' && opening.passable === false);

  addBox(parent, frame, start, end, 0, sill, materials.wall, `wall:${frame.wallId}:sill:${openingId}`);
  addBox(parent, frame, start, end, top, wallHeight, materials.wall, `wall:${frame.wallId}:lintel:${openingId}`);
  if (glass && top > sill) {
    addBox(
      parent,
      frame,
      start,
      end,
      sill,
      top,
      materials.glass,
      `wall:${frame.wallId}:glass:${openingId}`,
      Math.min(frame.thickness, 0.045),
    );
  }
}

function addBox(
  parent: THREE.Group,
  frame: WallFrame,
  start: number,
  end: number,
  low: number,
  high: number,
  material: THREE.Material,
  name: string,
  thickness = frame.thickness,
) {
  const width = end - start;
  const height = high - low;
  if (width < MIN || height < MIN || thickness < MIN) return;
  const mid = (start + end) / 2;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), material);
  mesh.name = name;
  mesh.position.set(frame.a[0] + frame.ux * mid, (low + high) / 2, frame.a[1] + frame.uz * mid);
  mesh.rotation.y = frame.angle;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

import type { FlatModel } from '@flatwalk/contract';

export type OverlayWallMark = {
  kind: 'wall';
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
  exterior: boolean;
};

export type OverlayOpeningMark = {
  kind: 'opening';
  id: string;
  openingKind: 'door' | 'window';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  entrance: boolean;
  passable: boolean;
};

export type OverlayRoomMark = {
  kind: 'room';
  id: string;
  x: number;
  y: number;
  label: string;
};

export type OverlayMark = OverlayWallMark | OverlayOpeningMark | OverlayRoomMark;

/** Pixel marks from the wall graph. Scale is px per meter; Geometry Core is not used. */
export function overlayMarks(model: FlatModel, pxPerMeter: number): OverlayMark[] {
  const marks: OverlayMark[] = [];
  const vertex = (id: string) => model.vertices[id];

  for (const [id, wall] of Object.entries(model.walls)) {
    const a = vertex(wall.a);
    const b = vertex(wall.b);
    if (!a || !b) continue;
    marks.push({
      kind: 'wall',
      id,
      x1: a[0] * pxPerMeter,
      y1: a[1] * pxPerMeter,
      x2: b[0] * pxPerMeter,
      y2: b[1] * pxPerMeter,
      thickness: wall.thickness * pxPerMeter,
      exterior: wall.exterior,
    });
  }

  for (const [id, opening] of Object.entries(model.openings)) {
    const wall = model.walls[opening.wall];
    const a = wall ? vertex(wall.a) : undefined;
    const b = wall ? vertex(wall.b) : undefined;
    if (!wall || !a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    const start = opening.at;
    const end = opening.at + opening.width;
    marks.push({
      kind: 'opening',
      id,
      openingKind: opening.kind,
      x1: (a[0] + ux * start) * pxPerMeter,
      y1: (a[1] + uy * start) * pxPerMeter,
      x2: (a[0] + ux * end) * pxPerMeter,
      y2: (a[1] + uy * end) * pxPerMeter,
      entrance: opening.kind === 'door' && opening.entrance === true,
      passable: opening.kind === 'door' ? opening.passable !== false : false,
    });
  }

  for (const [id, room] of Object.entries(model.rooms)) {
    marks.push({
      kind: 'room',
      id,
      x: room.anchor[0] * pxPerMeter,
      y: room.anchor[1] * pxPerMeter,
      label: room.label,
    });
  }

  return marks;
}

export function overlayIds(model: FlatModel) {
  return {
    rooms: Object.keys(model.rooms),
    walls: Object.keys(model.walls),
    openings: Object.keys(model.openings),
  };
}

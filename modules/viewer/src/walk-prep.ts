import type { FlatModel } from '@flatwalk/contract';
import { BuilderError, buildScene, type BuiltScene } from '@flatwalk/builder';
import { GeometryError, areas, collisions, roomPolygon, startPoint, type Areas, type CollisionSegment, type StartPoint } from '@flatwalk/geometry';
import { canStand, roomPolygons, PLAYER_RADIUS, type RoomPolygons } from './walk-math';
import { countLabel, formatArea } from './labels';

export type WalkData =
  | { available: true; start: StartPoint; segments: CollisionSegment[]; polygons: RoomPolygons; areas: Areas | null }
  | { available: false; reason: string; segments: CollisionSegment[]; polygons: RoomPolygons; areas: Areas | null };

export type WalkPrep = {
  scene: BuiltScene | null;
  sceneError: string | null;
  walk: WalkData;
  /** Plain-language lines for the diagnostics dialog; no entity ids. */
  diagnostics: string[];
};

const GEOMETRY_REASONS: Record<string, string> = {
  'invalid-start': 'the entrance is undefined or the start point intersects a wall',
  nonplanar: 'the wall graph is not planar',
  'ambiguous-mapping': 'the point belongs to multiple rooms',
  'missing-room': 'room not found',
  'wall-not-on-room': 'the wall is not on the room boundary',
};

function describeError(error: unknown): string {
  if (error instanceof GeometryError) return GEOMETRY_REASONS[error.code] ?? error.message;
  if (error instanceof BuilderError) return `Builder rejected the model (${error.message})`;
  return error instanceof Error ? error.message : String(error);
}

export function prepareWalk(model: FlatModel): WalkPrep {
  const diagnostics: string[] = [];
  const labels = (ids: string[]) => ids.map((id) => model.rooms[id]?.label ?? 'unnamed').join(', ');

  let scene: BuiltScene | null = null;
  let sceneError: string | null = null;
  try {
    scene = buildScene(model);
  } catch (error) {
    sceneError = describeError(error);
    diagnostics.push(`The 3D scene was not built: ${sceneError}.`);
  }

  const polygons = roomPolygons(model, roomPolygon);
  const roomIds = Object.keys(model.rooms);
  const withPolygon = roomIds.filter((id) => polygons[id]);
  const without = roomIds.filter((id) => !polygons[id]);
  diagnostics.push(`Room boundaries from Geometry Core: ${withPolygon.length} of ${roomIds.length}.${without.length ? ` Missing boundaries: ${labels(without)}.` : ''}`);

  let segments: CollisionSegment[] = [];
  let segmentsError: string | null = null;
  try {
    segments = collisions(model);
  } catch (error) {
    segmentsError = describeError(error);
  }
  if (segmentsError) diagnostics.push(`Collision geometry was not computed: ${segmentsError}.`);
  else diagnostics.push(`${countLabel(segments.length, ['collision segment', 'collision segments', 'collision segments'])}, player radius ${PLAYER_RADIUS} m.`);

  let computedAreas: Areas | null = null;
  try {
    computedAreas = areas(model);
    const declared = model.flat.areaDeclared;
    diagnostics.push(declared !== undefined
      ? `Model area ${formatArea(computedAreas.areaComputed)} versus ${formatArea(declared)} in the listing.`
      : `Model area ${formatArea(computedAreas.areaComputed)}.`);
  } catch (error) {
    diagnostics.push(`Areas were not computed: ${describeError(error)}.`);
  }

  let start: StartPoint | null = null;
  let startError: string | null = null;
  try {
    start = startPoint(model);
    if (!canStand(start.point, segments, PLAYER_RADIUS)) startError = 'the entrance start point intersects a wall';
  } catch (error) {
    startError = describeError(error);
  }

  if (start && !startError && !segmentsError) {
    diagnostics.push('The entrance start point was found; walkthrough is available.');
    return { scene, sceneError, walk: { available: true, start, segments, polygons, areas: computedAreas }, diagnostics };
  }
  const reason = startError ?? segmentsError ?? 'geometry is unavailable';
  diagnostics.push(`Walkthrough unavailable: ${reason}.`);
  return { scene, sceneError, walk: { available: false, reason, segments, polygons, areas: computedAreas }, diagnostics };
}

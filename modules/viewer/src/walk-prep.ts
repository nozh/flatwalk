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
  'invalid-start': 'вход не определён или старт попадает в стену',
  nonplanar: 'граф стен не планарен',
  'ambiguous-mapping': 'точка попадает в несколько помещений',
  'missing-room': 'помещение не найдено',
  'wall-not-on-room': 'стена не лежит на контуре помещения',
};

function describeError(error: unknown): string {
  if (error instanceof GeometryError) return GEOMETRY_REASONS[error.code] ?? error.message;
  if (error instanceof BuilderError) return `Builder отказался собирать модель (${error.message})`;
  return error instanceof Error ? error.message : String(error);
}

export function prepareWalk(model: FlatModel): WalkPrep {
  const diagnostics: string[] = [];
  const labels = (ids: string[]) => ids.map((id) => model.rooms[id]?.label ?? 'без названия').join(', ');

  let scene: BuiltScene | null = null;
  let sceneError: string | null = null;
  try {
    scene = buildScene(model);
  } catch (error) {
    sceneError = describeError(error);
    diagnostics.push(`3D-сцена не собрана: ${sceneError}.`);
  }

  const polygons = roomPolygons(model, roomPolygon);
  const roomIds = Object.keys(model.rooms);
  const withPolygon = roomIds.filter((id) => polygons[id]);
  const without = roomIds.filter((id) => !polygons[id]);
  diagnostics.push(`Контуры помещений по Geometry Core: ${withPolygon.length} из ${roomIds.length}.${without.length ? ` Без контура: ${labels(without)}.` : ''}`);

  let segments: CollisionSegment[] = [];
  let segmentsError: string | null = null;
  try {
    segments = collisions(model);
  } catch (error) {
    segmentsError = describeError(error);
  }
  if (segmentsError) diagnostics.push(`Коллизии не вычислены: ${segmentsError}.`);
  else diagnostics.push(`${countLabel(segments.length, ['отрезок коллизий', 'отрезка коллизий', 'отрезков коллизий'])}, радиус игрока ${PLAYER_RADIUS} м.`);

  let computedAreas: Areas | null = null;
  try {
    computedAreas = areas(model);
    const declared = model.flat.areaDeclared;
    diagnostics.push(declared !== undefined
      ? `Площадь по модели ${formatArea(computedAreas.areaComputed)} при ${formatArea(declared)} по объявлению.`
      : `Площадь по модели ${formatArea(computedAreas.areaComputed)}.`);
  } catch (error) {
    diagnostics.push(`Площади не вычислены: ${describeError(error)}.`);
  }

  let start: StartPoint | null = null;
  let startError: string | null = null;
  try {
    start = startPoint(model);
    if (!canStand(start.point, segments, PLAYER_RADIUS)) startError = 'старт от входа упирается в стену';
  } catch (error) {
    startError = describeError(error);
  }

  if (start && !startError && !segmentsError) {
    diagnostics.push('Старт от входа найден, прогулка доступна.');
    return { scene, sceneError, walk: { available: true, start, segments, polygons, areas: computedAreas }, diagnostics };
  }
  const reason = startError ?? segmentsError ?? 'геометрия недоступна';
  diagnostics.push(`Прогулка недоступна: ${reason}.`);
  return { scene, sceneError, walk: { available: false, reason, segments, polygons, areas: computedAreas }, diagnostics };
}

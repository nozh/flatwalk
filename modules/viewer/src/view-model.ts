import type { FlatModel, Meta } from '@flatwalk/contract';
import { resolveAssetUrl, type DataSource } from './source';
import { basisLabel, formatArea, formatDate, formatMeters, provenanceLabel, roomTypeLabel, siteLabel } from './labels';

export type RoomRow = {
  id: string;
  label: string;
  type: string;
  typeLabel: string;
  photoIds: string[];
  basisLabel: string;
  provenanceLabel: string;
  confidence?: number;
  reviewed: boolean;
  question?: string;
};

export type PhotoView = {
  id: string;
  /** 1-based position in the whole gallery, used as the human name «Фото 3». */
  number: number;
  url: string;
  width: number;
  height: number;
  roomId: string | null;
  roomLabel: string | null;
  faces: string | null;
  lookLabel?: string;
  confidence?: number;
  question?: string;
};

export type Assumption = {
  subject: string;
  value: string;
  basisLabel: string;
  provenanceLabel: string;
  confidence?: number;
  reviewed: boolean;
};

export type Question = {
  subject: string;
  text: string;
  roomId?: string;
  photoId?: string;
};

export type ListingView = {
  id: string;
  revision: number;
  title: string;
  source: { site: string; siteLabel: string; url?: string; listingId?: string; fetchedAtLabel: string };
  flat: { areaDeclared?: number; roomsDeclared?: number; roomCount: number; photoCount: number; wallHeight: number };
  rooms: RoomRow[];
  photos: PhotoView[];
  /** True when at least one photo names a room; otherwise the gallery is shared. */
  photosBound: boolean;
  planUrl: string | null;
  plan: { url: string | null; width?: number; height?: number; pxPerMeter?: number; basisLabel: string; confidence?: number; reviewed: boolean };
  assumptions: Assumption[];
  questions: Question[];
  /** Distinct producers of this model, in words. */
  provenance: string[];
  hasGeometry: boolean;
};

const FLOOR: Record<string, string> = { parquet: 'паркет', tile: 'плитка', laminate: 'ламинат', unknown: 'пол не определён' };
const TONE: Record<string, string> = { light: 'светлые стены', dark: 'тёмные стены', colored: 'цветные стены' };
const DEFAULTS: { key: 'wallHeight' | 'doorHeight' | 'windowSill' | 'windowHeight'; subject: string }[] = [
  { key: 'wallHeight', subject: 'Высота потолка' },
  { key: 'doorHeight', subject: 'Высота дверей' },
  { key: 'windowSill', subject: 'Подоконник' },
  { key: 'windowHeight', subject: 'Высота окон' },
];

export function byNumericId(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

function openingSubject(kind: string, entrance: boolean | undefined): string {
  if (entrance) return 'Проём: входная дверь';
  return kind === 'window' ? 'Проём: окно' : 'Проём: дверь';
}

export function listingView(model: FlatModel, source: DataSource): ListingView {
  const photoEntries = Object.entries(model.assets)
    .filter((entry): entry is [string, Extract<FlatModel['assets'][string], { kind: 'photo' }>] => entry[1].kind === 'photo')
    .sort(([a], [b]) => byNumericId(a, b));

  const photos: PhotoView[] = photoEntries.map(([id, asset], index) => {
    const room = asset.room ? model.rooms[asset.room] : undefined;
    const look = asset.look
      ? [FLOOR[asset.look.floor] ?? asset.look.floor, TONE[asset.look.wallTone] ?? asset.look.wallTone].join(', ')
      : undefined;
    return {
      id,
      number: index + 1,
      url: resolveAssetUrl(source, asset.url),
      width: asset.width,
      height: asset.height,
      roomId: asset.room && room ? asset.room : null,
      roomLabel: room?.label ?? null,
      faces: asset.faces ?? null,
      ...(look ? { lookLabel: look } : {}),
      ...(asset.meta.confidence !== undefined ? { confidence: asset.meta.confidence } : {}),
      ...(asset.meta.question ? { question: asset.meta.question } : {}),
    };
  });

  const rooms: RoomRow[] = Object.entries(model.rooms)
    .sort(([a], [b]) => byNumericId(a, b))
    .map(([id, room]) => ({
      id,
      label: room.label,
      type: room.type,
      typeLabel: roomTypeLabel(room.type),
      photoIds: photos.filter((photo) => photo.roomId === id).map((photo) => photo.id),
      basisLabel: basisLabel(room.meta.basis),
      provenanceLabel: provenanceLabel(room.meta.provenance),
      ...(room.meta.confidence !== undefined ? { confidence: room.meta.confidence } : {}),
      reviewed: room.meta.reviewed === true,
      ...(room.meta.question ? { question: room.meta.question } : {}),
    }));

  const planId = model.plan.asset;
  const planAsset = planId ? model.assets[planId] : undefined;
  const planImage = planAsset && (planAsset.kind === 'plan' || planAsset.kind === 'image') ? planAsset : undefined;
  const planUrl = planImage ? resolveAssetUrl(source, planImage.url) : null;

  const questions: Question[] = [];
  for (const room of rooms) if (room.question) questions.push({ subject: `Помещение «${room.label}»`, text: room.question, roomId: room.id });
  for (const [, opening] of Object.entries(model.openings).sort(([a], [b]) => byNumericId(a, b))) {
    if (opening.meta.question) {
      questions.push({ subject: openingSubject(opening.kind, opening.kind === 'door' ? opening.entrance : undefined), text: opening.meta.question });
    }
  }
  for (const [, wall] of Object.entries(model.walls).sort(([a], [b]) => byNumericId(a, b))) {
    if (wall.meta.question) questions.push({ subject: wall.exterior ? 'Наружная стена' : 'Стена', text: wall.meta.question });
  }
  for (const photo of photos) if (photo.question) questions.push({ subject: `Фото ${photo.number}`, text: photo.question, photoId: photo.id });
  if (model.plan.meta.question) questions.push({ subject: 'Масштаб плана', text: model.plan.meta.question });
  if (model.flat.meta.question) questions.push({ subject: 'Квартира', text: model.flat.meta.question });

  const assumptions: Assumption[] = DEFAULTS.map(({ key, subject }) => {
    const meta: Meta = model.flat.defaults.meta[key];
    return {
      subject,
      value: formatMeters(model.flat.defaults[key]),
      basisLabel: basisLabel(meta.basis),
      provenanceLabel: provenanceLabel(meta.provenance),
      ...(meta.confidence !== undefined ? { confidence: meta.confidence } : {}),
      reviewed: meta.reviewed === true,
    };
  });

  const provenanceSet = new Set<string>();
  const collect = (meta: Meta | undefined) => { if (meta) provenanceSet.add(provenanceLabel(meta.provenance)); };
  collect(model.flat.meta);
  collect(model.plan.meta);
  for (const collection of ['walls', 'openings', 'rooms', 'assets'] as const) {
    for (const entity of Object.values(model[collection])) collect(entity.meta);
  }
  for (const meta of Object.values(model.flat.defaults.meta)) collect(meta);

  const area = model.flat.areaDeclared;
  return {
    id: model.id,
    revision: model.revision,
    title: area !== undefined ? `Квартира ${formatArea(area)}` : 'Квартира',
    source: {
      site: model.source.site,
      siteLabel: siteLabel(model.source.site),
      ...(model.source.url ? { url: model.source.url } : {}),
      ...(model.source.listingId ? { listingId: model.source.listingId } : {}),
      fetchedAtLabel: formatDate(model.source.fetchedAt),
    },
    flat: {
      ...(area !== undefined ? { areaDeclared: area } : {}),
      ...(model.flat.roomsDeclared !== undefined ? { roomsDeclared: model.flat.roomsDeclared } : {}),
      roomCount: rooms.length,
      photoCount: photos.length,
      wallHeight: model.flat.defaults.wallHeight,
    },
    rooms,
    photos,
    photosBound: photos.some((photo) => photo.roomId !== null),
    planUrl,
    plan: {
      url: planUrl,
      ...(planImage ? { width: planImage.width, height: planImage.height } : {}),
      ...(model.plan.pxPerMeter !== undefined ? { pxPerMeter: model.plan.pxPerMeter } : {}),
      basisLabel: basisLabel(model.plan.meta.basis),
      ...(model.plan.meta.confidence !== undefined ? { confidence: model.plan.meta.confidence } : {}),
      reviewed: model.plan.meta.reviewed === true,
    },
    assumptions,
    questions,
    provenance: [...provenanceSet].sort((a, b) => a.localeCompare(b, 'ru')),
    hasGeometry: Object.keys(model.walls).length > 0,
  };
}

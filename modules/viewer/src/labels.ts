/** Human wording for contract enums and provenance strings. Unknown values pass through verbatim. */

const ROOM_TYPES: Record<string, string> = {
  living: 'жилая комната',
  bedroom: 'спальня',
  kitchen: 'кухня',
  bathroom: 'ванная',
  wc: 'санузел',
  hall: 'холл',
  corridor: 'коридор',
  storage: 'кладовая',
  unknown: 'тип не определён',
};

const BASIS: Record<string, string> = {
  declared: 'по объявлению',
  inferred: 'выведено из плана',
  assumed: 'принято по умолчанию',
  'declared-area': 'подобран по заявленной площади',
};

const PROVENANCE: [RegExp, string][] = [
  [/^fixture\/manual/, 'ручная разметка эталона'],
  [/^plan-parser\/opencv/, 'распознавание плана (OpenCV)'],
  [/^plan-parser\/grok-rects/, 'схема плана прямоугольниками (Grok)'],
  [/^plan-parser\/grok/, 'семантика плана (Grok)'],
  [/^photo-matcher/, 'сопоставление фото (Grok)'],
  [/^dresser/, 'отделка (Dresser)'],
  [/^importer/, 'импорт объявления'],
  [/^validator/, 'авторемонт Validator'],
  [/^editor/, 'правка в редакторе'],
  [/^human$/, 'правка человека'],
  [/^viewer-test/, 'тестовые данные Viewer'],
];

const SITES: Record<string, string> = {
  cityexpert: 'CityExpert',
  manual: 'ручная загрузка',
};

export function roomTypeLabel(type: string): string {
  return ROOM_TYPES[type] ?? type;
}

export function basisLabel(basis: string): string {
  return BASIS[basis] ?? basis;
}

export function provenanceLabel(provenance: string): string {
  for (const [pattern, label] of PROVENANCE) if (pattern.test(provenance)) return label;
  return provenance;
}

export function siteLabel(site: string): string {
  return SITES[site] ?? site;
}

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

export function formatArea(value: number): string {
  return `${number.format(value)} м²`;
}

export function formatMeters(value: number): string {
  return `${number.format(value)} м`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date).replace(/\s*г\.$/, '');
}

export function pluralize(count: number, forms: [string, string, string]): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function countLabel(count: number, forms: [string, string, string]): string {
  return `${number.format(count)} ${pluralize(count, forms)}`;
}

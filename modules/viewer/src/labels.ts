/** Human wording for contract enums and provenance strings. Unknown values pass through verbatim. */

const ROOM_TYPES: Record<string, string> = {
  living: 'living room',
  bedroom: 'bedroom',
  kitchen: 'kitchen',
  bathroom: 'bathroom',
  wc: 'toilet',
  hall: 'hall',
  corridor: 'corridor',
  storage: 'storage',
  unknown: 'room type unknown',
};

const BASIS: Record<string, string> = {
  declared: 'from the listing',
  inferred: 'inferred from the floor plan',
  assumed: 'default assumption',
  'declared-area': 'fitted to the listed area',
};

const PROVENANCE: [RegExp, string][] = [
  [/^fixture\/manual/, 'manual reference markup'],
  [/^plan-parser\/opencv/, 'floor-plan recognition (OpenCV)'],
  [/^plan-parser\/grok-rects/, 'rectangular floor-plan layout (Grok)'],
  [/^plan-parser\/grok/, 'floor-plan semantics (Grok)'],
  [/^photo-matcher/, 'photo matching (Grok)'],
  [/^dresser/, 'interior finish (Dresser)'],
  [/^importer/, 'listing import'],
  [/^validator/, 'Validator auto-repair'],
  [/^editor/, 'editor change'],
  [/^human$/, 'human change'],
  [/^viewer-test/, 'Viewer test data'],
];

const SITES: Record<string, string> = {
  cityexpert: 'CityExpert',
  manual: 'manual upload',
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

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function formatArea(value: number): string {
  return `${number.format(value)} m²`;
}

export function formatMeters(value: number): string {
  return `${number.format(value)} m`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function pluralize(count: number, forms: [string, string, string]): string {
  return count === 1 ? forms[0] : forms[2];
}

export function countLabel(count: number, forms: [string, string, string]): string {
  return `${number.format(count)} ${pluralize(count, forms)}`;
}

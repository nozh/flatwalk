// Small deliberately incomplete geometry. This is NOT the manual 54541 acceptance fixture.
const meta = { provenance: 'importer@0.1', basis: 'assumed' };
export const empty = {
  schemaVersion: '0.1', id: 'synthetic', revision: 0,
  source: { site: 'manual', fetchedAt: '2026-09-12T10:00:00Z' },
  flat: { meta: { provenance: 'importer@0.1', basis: 'declared' }, defaults: {
    wallHeight: 2.8, doorHeight: 2.1, windowSill: 0.9, windowHeight: 1.5,
    meta: Object.fromEntries(['wallHeight', 'doorHeight', 'windowSill', 'windowHeight'].map(k => [k, { ...meta }])),
  } }, plan: { asset: null, meta }, vertices: {}, walls: {}, openings: {}, rooms: {}, assets: {},
};
export const small = {
  ...empty, revision: 1,
  vertices: { v1: [0, 0], v2: [4, 0] },
  walls: { w1: { a: 'v1', b: 'v2', thickness: 0.2, exterior: true, meta } },
  openings: { o1: { wall: 'w1', kind: 'door', at: 0.2, width: 0.9, entrance: true, meta } },
  rooms: { r1: { anchor: [1, 1], type: 'living', label: 'Synthetic room', meta, dressing: {
    level: 2, floor: 'parquet', panorama: 'pano1', yaw: 90, yawFor: 'pano1',
    meta: { level: meta, floor: meta, panorama: meta, yaw: meta },
  } } },
  assets: {
    'plan-01': { kind: 'plan', url: 'materials/plan.png', width: 100, height: 100, meta },
    p1: { kind: 'photo', url: 'materials/photo.jpg', width: 300, height: 200, room: 'r1', faces: 'w1', meta, look: { floor: 'unknown', wallTone: 'light' } },
    pano1: { kind: 'panorama', url: 'materials/pano.jpg', width: 200, height: 100, projection: 'equirectangular', generatedBy: 'synthetic-test', fromPhoto: 'p1', meta },
  }, plan: { asset: 'plan-01', meta },
};
export const patch = { schemaVersion: '0.1', modelId: 'synthetic', baseRevision: 1, module: 'editor@0.1', ops: [{ op: 'set', path: 'assets.p1.faces', value: null }, { op: 'unset', path: 'assets.p1.look' }] };
export const report = {
  schemaVersion: '0.1', modelId: 'synthetic', revision: 1, walkReady: false, confirmation: 0.5,
  checks: ['pass', 'fail', 'unverified', 'skipped'].map(status => ({ checkId: `test.${status}`, layer: 'geometry', status, severity: 'error', entities: ['walls.w1'], message: '' })),
  review: { items: [{ id: 'rv1', path: 'walls.w1', severity: 'warning', reason: 'Synthetic review' }] },
};
export const context = { schemaVersion: '0.1', modelId: 'synthetic', baseRevision: 0, currentRevision: 2, changes: [
  { revision: 1, touchedPaths: ['vertices.v1'], touchedOwners: ['vertices.v1', 'walls.w1'] },
  { revision: 2, touchedPaths: ['rooms.r1.dressing.yaw'], touchedOwners: ['rooms.r1.dressing.yaw'] },
] };
export type Case = { name: string; kind: 'FlatModel' | 'Patch' | 'ValidationReport' | 'RevisionContext'; value: unknown; valid: boolean };
export const cases: Case[] = [];
function add(name: string, kind: Case['kind'], value: unknown, valid = true) { cases.push({ name, kind, value: structuredClone(value), valid }); }
function change(name: string, path: string, value: unknown, valid = false, source: unknown = small, kind: Case['kind'] = 'FlatModel', remove = false) {
  const copy = structuredClone(source) as any;
  const parts = path.split('.'); const key = parts.pop()!;
  const parent = parts.reduce((o, k) => o[k], copy);
  if (remove) delete parent[key]; else parent[key] = value;
  add(name, kind, copy, valid);
}
add('empty rev 0', 'FlatModel', empty);
add('small graph with bindings', 'FlatModel', small);
for (const [name, path, value] of [
  ['unknown version', 'schemaVersion', '0.2'], ['negative revision', 'revision', -1], ['fractional revision', 'revision', 0.5],
  ['string height', 'flat.defaults.wallHeight', '2.8'], ['zero height', 'flat.defaults.wallHeight', 0], ['bad point', 'vertices.v1', [1, 2, 3]],
  ['bad ID', 'vertices', { 'bad.id': [0, 0] }], ['ID trailing newline', 'id', 'synthetic\n'], ['prototype ID', 'vertices', JSON.parse('{"__proto__":[0,0]}')],
  ['missing vertex', 'walls.w1.a', 'gone'], ['missing wall', 'openings.o1.wall', 'gone'], ['missing room', 'assets.p1.room', 'gone'],
  ['missing faces', 'assets.p1.faces', 'gone'], ['wrong plan kind', 'plan.asset', 'p1'], ['wrong panorama kind', 'rooms.r1.dressing.panorama', 'p1'],
  ['wrong photo kind', 'assets.pano1.fromPhoto', 'plan-01'], ['faces without room', 'assets.p1.room', null],
  ['bad confidence', 'assets.p1.meta.confidence', 1.1], ['bad basis', 'plan.meta.basis', 'measured'], ['unknown root', 'review', {}],
  ['unknown field', 'walls.w1.foo', 1], ['bad size', 'assets.p1.width', 0], ['bad date', 'source.fetchedAt', 'yesterday'],
  ['bad yaw', 'rooms.r1.dressing.yaw', 360], ['window cannot retain entrance', 'openings.o1.kind', 'window'],
  ['zero scale', 'plan.pxPerMeter', 0], ['null scale', 'plan.pxPerMeter', null], ['inferred scale', 'plan.meta.basis', 'inferred'],
] as const) change(name, path, value);
for (const path of ['assets.pano1.meta', 'assets.p1.room', 'flat.defaults.meta.doorHeight', 'rooms.r1.dressing.meta.floor', 'rooms.r1.dressing.panorama', 'rooms.r1.dressing.yawFor']) change(`missing ${path}`, path, null, false, small, 'FlatModel', true);
change('room without wall', 'assets.p1.faces', null, true);
change('unbound photo', 'assets.p1', { ...small.assets.p1, room: null, faces: null }, true);
change('manual scale', 'plan.meta', { provenance: 'human', basis: 'declared', reviewed: true }, true);
change('confirmation preserves assumption', 'flat.defaults.meta.wallHeight', { ...meta, reviewed: true }, true);
change('independent human yaw', 'rooms.r1.dressing.meta.yaw', { provenance: 'human', basis: 'declared', reviewed: true }, true);
change('historical yaw kept but inactive', 'rooms.r1.dressing.yawFor', 'old-pano', true);
add('set unset nullable', 'Patch', patch);
change('empty patch', 'ops', [], true, patch, 'Patch');
for (const [name, op] of [
  ['missing value', { op: 'set', path: 'walls.w1' }], ['unset value', { op: 'unset', path: 'walls.w1', value: null }],
  ['unknown op', { op: 'add', path: 'walls.w1', value: {} }], ['unsafe path', { op: 'set', path: 'assets.__proto__.x', value: 1 }],
  ['empty path segment', { op: 'set', path: 'assets..x', value: 1 }], ['immutable revision', { op: 'set', path: 'revision', value: 2 }],
] as const) change(name, 'ops', [op], false, patch, 'Patch');
change('patch missing modelId', 'modelId', null, false, patch, 'Patch', true);
change('patch unknown version', 'schemaVersion', '1', false, patch, 'Patch');
const alternative = { module: 'dresser@0.1', baseRevision: 0, atRevision: 1, reason: 'human', op: { op: 'unset', path: 'rooms.r1.dressing.panorama' } };
change('typed alternative', 'rooms.r1.meta.alternatives', [alternative], true);
change('bad alternative', 'rooms.r1.meta.alternatives', [{ ...alternative, reason: 'whatever' }]);
change('typed repair', 'walls.w1.meta.repair', [{ module: 'validator/repair@0.1', baseRevision: 0, rule: 'snap', ops: [{ op: 'set', path: 'vertices.v1', value: [0, 0] }], message: 'Synthetic record' }], true);
add('all statuses', 'ValidationReport', report);
change('bad confirmation', 'confirmation', 1.1, false, report, 'ValidationReport');
change('bad check status', 'checks.0.status', 'ok', false, report, 'ValidationReport');
change('duplicate check', 'checks', [...report.checks, report.checks[0]], false, report, 'ValidationReport');
change('duplicate review', 'review.items', [...report.review.items, ...report.review.items], false, report, 'ValidationReport');
change('matching fix', 'checks.0.fix', patch, true, report, 'ValidationReport');
change('stale fix', 'checks.0.fix', { ...patch, baseRevision: 0 }, false, report, 'ValidationReport');
add('complete history', 'RevisionContext', context);
change('history gap', 'changes', context.changes.slice(1), false, context, 'RevisionContext');
change('history order', 'changes', [...context.changes].reverse(), false, context, 'RevisionContext');
add('current base', 'RevisionContext', { ...context, baseRevision: 2, changes: [] });
add('future base', 'RevisionContext', { ...context, baseRevision: 3, changes: [] }, false);

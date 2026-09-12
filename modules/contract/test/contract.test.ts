import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FlatModelSchema, PatchSchema, ValidationReportSchema, RevisionContextSchema, ownersForPath, listMetaOwners, metaPathForOwner, pathsOverlap } from '../src/index.js';
import { cases, small, empty } from './cases.js';
const schemas = { FlatModel: FlatModelSchema, Patch: PatchSchema, ValidationReport: ValidationReportSchema, RevisionContext: RevisionContextSchema };
for (const c of cases) test(c.name, () => {
  const result = schemas[c.kind].safeParse(c.value);
  assert.equal(result.success, c.valid, result.success ? 'Unexpected acceptance' : JSON.stringify(result.error.issues));
});
test('Python corpus exactly matches TS cases', () => assert.deepEqual(JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8')), cases));
test('references are checked only after all linked ops, independent of insertion order', () => {
  const base = FlatModelSchema.parse(empty);
  // A test-only assembly, deliberately no Resolver/human/conflict implementation.
  const ops = PatchSchema.parse({ schemaVersion: '0.1', modelId: base.id, baseRevision: 0, module: 'test@0.1', ops: [
    { op: 'set', path: 'walls', value: small.walls }, { op: 'set', path: 'openings', value: small.openings },
    { op: 'set', path: 'vertices', value: small.vertices },
  ] }).ops;
  const candidate: Record<string, unknown> = structuredClone(base);
  candidate[ops[0]!.path] = small.walls;
  assert.equal(FlatModelSchema.safeParse(candidate).success, false);
  for (const op of ops) if (op.op === 'set') candidate[op.path] = op.value;
  assert.equal(FlatModelSchema.safeParse(candidate).success, true);
  assert.deepEqual(base.vertices, {});
  delete (candidate.vertices as Record<string, unknown>).v1;
  const invalid = FlatModelSchema.safeParse(candidate);
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.ok(invalid.error.issues.some(i => i.path.join('.') === 'walls.w1.a'));
});
test('default/dressing metadata maps keep independent owners', () => {
  const model = FlatModelSchema.parse(small);
  assert.deepEqual(ownersForPath(model, 'flat.defaults.meta.wallHeight.reviewed'), ['flat.defaults.wallHeight']);
  assert.deepEqual(ownersForPath(model, 'rooms.r1.dressing.meta.yaw'), ['rooms.r1.dressing.yaw']);
  assert.deepEqual(ownersForPath(model, 'rooms.r1.dressing.yawFor'), ['rooms.r1.dressing.yaw']);
  assert.equal(metaPathForOwner('rooms.r1.dressing.yaw'), 'rooms.r1.dressing.meta.yaw');
  assert.equal(pathsOverlap('rooms.r1.dressing.yaw', 'rooms.r1.dressing.floor'), false);
  assert.equal(pathsOverlap('rooms.r1', 'rooms.r10'), false);
  assert.equal(pathsOverlap('rooms.r1', 'rooms.r1.dressing.yaw'), true);
});
test('vertices expose before and after wall owners for historical conflict checks', () => {
  const model = FlatModelSchema.parse(small);
  assert.deepEqual(ownersForPath(model, 'vertices.v1'), ['vertices.v1', 'walls.w1']);
  delete model.walls.w1;
  assert.deepEqual(ownersForPath(model, 'vertices.v1'), ['vertices.v1']);
  assert.equal(metaPathForOwner('vertices.v1'), null);
});
test('Zod rejects non-JSON input and nonfinite numbers without coercion', () => {
  for (const value of [undefined, NaN, Infinity, 1n, () => 1]) {
    assert.equal(PatchSchema.safeParse({ schemaVersion: '0.1', modelId: 'synthetic', baseRevision: 0, module: 'test', ops: [{ op: 'set', path: 'flat.defaults.wallHeight', value }] }).success, false);
  }
  const model = structuredClone(small); model.vertices.v1 = [Infinity, 0];
  assert.equal(FlatModelSchema.safeParse(model).success, false);
});

test('whole-parent replacement includes nested owners but semantic room edits stay independent', () => {
  const model = FlatModelSchema.parse(small);
  assert.ok(ownersForPath(model, 'rooms.r1').includes('rooms.r1.dressing.yaw'));
  assert.ok(ownersForPath(model, 'flat').includes('flat.defaults.doorHeight'));
  assert.deepEqual(ownersForPath(model, 'rooms.r1.type'), ['rooms.r1']);
  assert.ok(listMetaOwners(model).includes('assets.pano1'));
  assert.ok(!listMetaOwners(model).includes('vertices.v1'));
});

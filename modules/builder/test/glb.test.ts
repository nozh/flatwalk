import { describe, expect, it } from 'vitest';
import { BuilderError, build, toGLB } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

describe('contract gate', () => {
  it('refuses a model that fails FlatModelSchema', () => {
    const model = oneRoom();
    (model as { schemaVersion: string }).schemaVersion = '9.9';
    expect(() => build(model, { floors: false })).toThrow(BuilderError);
  });
});

describe('toGLB', () => {
  it('returns a non-empty GLB buffer from Node', async () => {
    const buffer = await toGLB(build(oneRoom(), { floors: false }));
    expect(buffer.byteLength).toBeGreaterThan(100);
    const magic = new TextDecoder().decode(buffer.slice(0, 4));
    expect(magic).toBe('glTF');
  });
});

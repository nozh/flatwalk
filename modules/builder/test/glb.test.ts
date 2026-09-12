import { describe, expect, it } from 'vitest';
import { build, toGLB } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

describe('toGLB', () => {
  it('returns a non-empty GLB buffer from Node', async () => {
    const buffer = await toGLB(build(oneRoom(), { floors: false }));
    expect(buffer.byteLength).toBeGreaterThan(100);
    const magic = new TextDecoder().decode(buffer.slice(0, 4));
    expect(magic).toBe('glTF');
  });
});

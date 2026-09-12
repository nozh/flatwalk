import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { FlatModelSchema, SCHEMA_VERSION, validateFlatModel } from '@flatwalk/contract';
import { BuilderError, build } from '../src/index.ts';
import { oneRoom } from './helpers.ts';

const require = createRequire(import.meta.url);

describe('public @flatwalk/contract 0.1.0', () => {
  it('gates assembly with FlatModelSchema, not JSON Schema alone', () => {
    expect(SCHEMA_VERSION).toBe('0.1');
    const broken = oneRoom();
    broken.walls.wN = { ...broken.walls.wN!, a: 'missing', b: 'v2' };
    expect(validateFlatModel(broken).success).toBe(false);
    expect(FlatModelSchema.safeParse(broken).success).toBe(false);
    expect(() => build(broken, { floors: false })).toThrow(BuilderError);
  });

  it('resolves the published JSON Schema as a structural artifact', () => {
    const schemaPath = require.resolve('@flatwalk/contract/schemas/FlatModel.schema.json');
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as { title?: string; $schema?: string };
    expect(schemaPath).toContain('modules/contract/schemas/FlatModel.schema.json');
    expect(schema.$schema).toMatch(/2020-12/);
    const dangling = oneRoom();
    dangling.walls.wN = { ...dangling.walls.wN!, a: 'missing', b: 'v2' };
    const properties = (schema as { properties?: { vertices?: unknown } }).properties;
    expect(properties?.vertices).toBeTruthy();
  });
});

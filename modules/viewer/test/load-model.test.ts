import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFlatModel } from '../src/load-model';
import { validateFlatModel } from '@flatwalk/contract';

const dir = dirname(fileURLToPath(import.meta.url));
const synthetic = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8'));

describe('loadFlatModel', () => {
  it('loads a synthetic model that is not the 54541 listing', async () => {
    expect(synthetic.id).toBe('viewer-synthetic');
    expect(synthetic.id).not.toBe('cityexpert-54541');
    expect(validateFlatModel(synthetic).success).toBe(true);

    const result = await loadFlatModel({ kind: 'static' }, {
      fetchJson: async () => ({ ok: true, status: 200, body: structuredClone(synthetic) }),
    });
    expect(result).toEqual({ status: 'ok', model: synthetic, source: { kind: 'static' } });
  });

  it('reports a missing file', async () => {
    const result = await loadFlatModel({ kind: 'fixture' }, {
      fetchJson: async () => ({ ok: false, status: 404, body: null }),
    });
    expect(result.status).toBe('missing');
    if (result.status === 'missing') {
      expect(result.url).toBe('/fixtures/54541/flat.model.json');
      expect(result.source).toEqual({ kind: 'fixture' });
    }
  });

  it('reports a contract-invalid document', async () => {
    const result = await loadFlatModel({ kind: 'static' }, {
      fetchJson: async () => ({ ok: true, status: 200, body: { id: 'nope' } }),
    });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.issues.length).toBeGreaterThan(0);
  });
});

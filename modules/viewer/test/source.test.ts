import { describe, expect, it } from 'vitest';
import { dataSourceFromSearch, modelUrl, resolveAssetUrl } from '../src/source';

describe('static / fixture source', () => {
  it('defaults to the run-folder latest model', () => {
    expect(dataSourceFromSearch('')).toEqual({ kind: 'static' });
    expect(dataSourceFromSearch('?foo=1')).toEqual({ kind: 'static' });
    expect(modelUrl({ kind: 'static' })).toBe('/model/latest.json');
  });

  it('uses the bundled 54541 path only for ?src=fixture', () => {
    expect(dataSourceFromSearch('?src=fixture')).toEqual({ kind: 'fixture' });
    expect(modelUrl({ kind: 'fixture' })).toBe('/fixtures/54541/flat.model.json');
  });

  it('resolves relative assets against the run folder or the 54541 fixture dir', () => {
    expect(resolveAssetUrl({ kind: 'static' }, 'materials/plan.png')).toBe('/materials/plan.png');
    expect(resolveAssetUrl({ kind: 'fixture' }, 'plan.png')).toBe('/fixtures/54541/plan.png');
    expect(resolveAssetUrl({ kind: 'fixture' }, '/already/absolute.png')).toBe('/already/absolute.png');
  });
});

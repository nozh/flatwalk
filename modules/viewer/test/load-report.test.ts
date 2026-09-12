import { describe, expect, it } from 'vitest';
import { loadValidationReport, reportUrl } from '../src/load-report';

const report = {
  schemaVersion: '0.1',
  modelId: 'viewer-synthetic',
  revision: 1,
  walkReady: false,
  confirmation: 0.2,
  checks: [
    { checkId: 'contract.schema', layer: 'contract', status: 'pass', severity: 'error', entities: [], message: 'Схема соблюдена' },
    { checkId: 'geometry.faces', layer: 'geometry', status: 'unverified', severity: 'error', entities: [], message: 'Грани не считались' },
  ],
  review: { items: [{ id: 'q1', path: 'rooms.r2', severity: 'warning', reason: 'низкая уверенность' }] },
};

describe('reportUrl', () => {
  it('points at the run folder or the bundled fixture with a zero-padded revision', () => {
    expect(reportUrl({ kind: 'static' }, 1)).toBe('/validation/rev-001.json');
    expect(reportUrl({ kind: 'fixture' }, 0)).toBe('/fixtures/54541/validation/rev-000.json');
  });
});

describe('loadValidationReport', () => {
  it('returns the report for the same model and revision', async () => {
    const result = await loadValidationReport({ kind: 'static' }, { id: 'viewer-synthetic', revision: 1 }, {
      fetchJson: async () => ({ ok: true, status: 200, body: structuredClone(report) }),
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.report.walkReady).toBe(false);
  });

  it('treats a missing file as no report, not as an error', async () => {
    const result = await loadValidationReport({ kind: 'fixture' }, { id: 'cityexpert-54541', revision: 0 }, {
      fetchJson: async () => ({ ok: false, status: 404, body: null }),
    });
    expect(result).toEqual({ status: 'missing', url: '/fixtures/54541/validation/rev-000.json' });
  });

  it('flags a report for another model or revision as stale', async () => {
    const result = await loadValidationReport({ kind: 'static' }, { id: 'viewer-synthetic', revision: 2 }, {
      fetchJson: async () => ({ ok: true, status: 200, body: structuredClone(report) }),
    });
    expect(result.status).toBe('stale');
  });

  it('rejects a document the contract does not accept', async () => {
    const result = await loadValidationReport({ kind: 'static' }, { id: 'viewer-synthetic', revision: 1 }, {
      fetchJson: async () => ({ ok: true, status: 200, body: { walkReady: 'yes' } }),
    });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.issues.length).toBeGreaterThan(0);
  });

  it('survives a network failure as a missing report', async () => {
    const result = await loadValidationReport({ kind: 'static' }, { id: 'viewer-synthetic', revision: 1 }, {
      fetchJson: async () => { throw new Error('offline'); },
    });
    expect(result.status).toBe('missing');
  });
});

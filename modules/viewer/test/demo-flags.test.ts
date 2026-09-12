import { describe, expect, it } from 'vitest';
import { DEMO_DISCLOSURE, SYNTHETIC_FIXTURE_DISCLOSURE, isSyntheticModel, parseViewerQuery } from '../src/demo-flags';

describe('parseViewerQuery', () => {
  it('keeps the run folder as default outside the public demo', () => {
    expect(parseViewerQuery('')).toEqual({ source: { kind: 'static' }, demo: false });
    expect(parseViewerQuery('?src=fixture')).toEqual({ source: { kind: 'fixture' }, demo: false });
  });

  it('preserves demo=1 on fixture deep links', () => {
    expect(parseViewerQuery('?src=fixture&demo=1')).toEqual({ source: { kind: 'fixture' }, demo: true });
  });

  it('forces the prepared fixture and demo banner on the public site', () => {
    const query = parseViewerQuery('?src=static', true);
    expect(query.source).toEqual({ kind: 'fixture' });
    expect(query.demo).toBe(true);
    expect(query.rewriteSearch).toBe('?src=fixture&demo=1');
  });

  it('does not rewrite an already canonical public demo URL', () => {
    expect(parseViewerQuery('?src=fixture&demo=1', true)).toEqual({
      source: { kind: 'fixture' },
      demo: true,
    });
  });

  it('keeps a job id locally and never sends the public demo to a local job API', () => {
    expect(parseViewerQuery('?job=abc-1', false, 'http://127.0.0.1:8787')).toEqual({
      source: { kind: 'job', origin: 'http://127.0.0.1:8787', jobId: 'abc-1' },
      demo: false,
      jobId: 'abc-1',
    });
    const publicJob = parseViewerQuery('?job=abc-1', true, 'http://127.0.0.1:8787');
    expect(publicJob.source).toEqual({ kind: 'fixture' });
    expect(publicJob.rewriteSearch).toContain('src=fixture');
    expect(publicJob.rewriteSearch).not.toContain('job=');
    expect(SYNTHETIC_FIXTURE_DISCLOSURE).toMatch(/not recognition/i);
  });
});

describe('isSyntheticModel', () => {
  it('marks viewer-test models and unlabeled manual uploads, not listing 54541', () => {
    expect(isSyntheticModel({ id: 'viewer-synthetic', source: { site: 'manual', fetchedAt: '2026-09-12T10:00:00Z' } })).toBe(true);
    expect(isSyntheticModel({
      id: 'cityexpert-54541',
      source: { site: 'cityexpert', listingId: '54541', url: 'https://cityexpert.rs/x', fetchedAt: '2026-09-12T10:00:00Z' },
    })).toBe(false);
    expect(DEMO_DISCLOSURE).toMatch(/simulated/);
  });
});

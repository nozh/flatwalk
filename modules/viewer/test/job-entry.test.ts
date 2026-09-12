import { describe, expect, it, vi } from 'vitest';
import { mountJobEntry } from '../src/job-entry';

describe('mountJobEntry', () => {
  it('posts one fixture job even if the submit control is activated twice', async () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ job: { id: 'job-1' } }) };
      }
      if (url.endsWith('/job-1')) {
        return {
          ok: true,
          json: async () => ({
            job: { id: 'job-1', status: 'succeeded', stage: 'publish', adapters: 'fixture', walkReady: true },
            runs: [{ stage: 'parse', outcome: 'success', diagnostics: { grokRects: { synthetic: true } } }],
            materials: [{ assetId: 'plan', kind: 'plan', url: '/api/jobs/job-1/file/materials/plan.png' }],
            model: { id: 'cityexpert-54541', revision: 1 },
            report: { modelId: 'cityexpert-54541', revision: 1, walkReady: true },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const openJobResult = vi.fn(async () => {});
    const openPreparedDemo = vi.fn(async () => {});
    mountJobEntry(root, {
      origin: 'http://127.0.0.1:8787',
      openPreparedDemo,
      openJobResult,
    });
    const form = root.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(openJobResult).toHaveBeenCalledTimes(1));
    const posts = fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]?.body))).toEqual({ from: 'fixtures/54541', adapters: 'fixture' });
    expect(window.location.search).toBe('?job=job-1');
    expect(openPreparedDemo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps Open prepared demo as an explicit action and shows failed-job materials', async () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        job: { id: 'job-fail', status: 'failed', stage: 'parse', adapters: 'fixture', error: 'live key missing' },
        runs: [{ stage: 'parse', outcome: 'failure', error: 'live key missing' }],
        materials: [{ assetId: 'photo-01', kind: 'photo', url: '/api/jobs/job-fail/file/materials/photos/photo-01.jpg' }],
      }),
    })));
    const openPreparedDemo = vi.fn(async () => {});
    mountJobEntry(root, {
      origin: 'http://127.0.0.1:8787',
      jobId: 'job-fail',
      openPreparedDemo,
      openJobResult: vi.fn(async () => {}),
    });
    await vi.waitFor(() => expect(root.textContent).toMatch(/Job failed/));
    expect(root.textContent).toMatch(/live key missing/);
    expect(root.querySelector('a')?.href).toContain('/api/jobs/job-fail/file/materials/photos/photo-01.jpg');
    expect(root.querySelector('[data-action="retry"]')).not.toBeNull();
    root.querySelector<HTMLButtonElement>('[data-action="prepared-demo"]')?.click();
    await vi.waitFor(() => expect(openPreparedDemo).toHaveBeenCalledTimes(1));
    vi.unstubAllGlobals();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDemoEntry } from '../src/demo-entry';
import { resetHeroFigureCache } from '../src/entry-shell';

afterEach(() => {
  resetHeroFigureCache();
  vi.unstubAllGlobals();
});

describe('mountDemoEntry', () => {
  it('sets src=fixture&demo=1 before opening the apartment', async () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    window.history.replaceState(null, '', '/');
    // The shared first screen draws the reference apartment; this test only cares about the form.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const open = vi.fn(async () => {});
    mountDemoEntry(root, open);
    root.querySelector<HTMLButtonElement>('.demo-skip')?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('?src=fixture&demo=1');
    expect(root.querySelector('.demo-note')?.textContent).toMatch(/not analyzed/i);
  });
});

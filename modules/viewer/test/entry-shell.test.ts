import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountHeroFigure, renderEntry, resetHeroFigureCache } from '../src/entry-shell';

const dir = dirname(fileURLToPath(import.meta.url));
const reference = readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8');

afterEach(() => {
  resetHeroFigureCache();
  vi.unstubAllGlobals();
});

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  root.innerHTML = renderEntry('<form class="entry-form"></form>');
  return root;
}

describe('renderEntry', () => {
  it('gives both entry modes the same headline, source materials and honest caption', () => {
    const root = mount();
    expect(root.querySelector('h1')?.textContent).toBe('See how the apartment fits together.');
    expect(root.querySelectorAll('.figure-thumb')).toHaveLength(4);
    for (const image of root.querySelectorAll('img')) expect(image.getAttribute('alt')).toBeTruthy();
    expect(root.querySelector('figcaption')?.textContent).toMatch(/not a surveyed measurement/);
    expect(root.querySelector('.entry-body form')).not.toBeNull();
  });
});

describe('mountHeroFigure', () => {
  it('draws the reference apartment from its own FlatModel, once per page', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(reference) }));
    vi.stubGlobal('fetch', fetchMock);

    const root = mount();
    mountHeroFigure(root);
    await vi.waitFor(() => expect(root.querySelector('.hero-massing')).not.toBeNull());
    expect(root.querySelector('.hero-massing')?.classList.contains('is-entering')).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/fixtures/54541/flat.model.json');

    // A repaint (job progress, retry) reuses the drawing instead of fetching again.
    const again = mount();
    mountHeroFigure(again);
    expect(again.querySelector('.hero-massing')).not.toBeNull();
    expect(again.querySelector('.hero-massing')?.classList.contains('is-entering')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hides the figure rather than inventing geometry when the model is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const root = mount();
    mountHeroFigure(root);
    await vi.waitFor(() => expect(root.querySelector('.entry-figure')?.getAttribute('data-model')).toBe('unavailable'));
    expect(root.querySelector('.hero-massing')).toBeNull();
    expect(root.querySelectorAll('.figure-thumb')).toHaveLength(4);
  });
});

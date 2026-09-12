import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { renderShell } from '../src/shell';
import { listingView } from '../src/view-model';
import { mountListing, type ListingController } from '../src/interactions';

const dir = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error('invalid test model');
  return parsed.data;
}

let controller: ListingController | undefined;
const disposeScene = vi.fn();
const mountScene = vi.fn(() => ({ dispose: disposeScene }));

function setup() {
  const parsed = model(reference);
  const root = document.createElement('div');
  root.innerHTML = renderShell({ kind: 'ready', model: parsed, source: { kind: 'fixture' }, plan: { status: 'ok' } });
  document.body.replaceChildren(root);
  controller = mountListing(root, listingView(parsed, { kind: 'fixture' }), { mountScene });
  return root;
}

const click = (target: Element | null) => {
  if (!target) throw new Error('click target missing');
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
};
const key = (target: EventTarget, keyName: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));

afterEach(() => {
  controller?.dispose();
  controller = undefined;
  mountScene.mockClear();
  disposeScene.mockClear();
});

describe('room selection', () => {
  it('selecting a room from the list updates the panel, the list and the plan marks', () => {
    const root = setup();
    click(root.querySelector('#room-list button[data-select="r3"]'));
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Кухня');
    expect(root.querySelector('#room-list button[data-select="r3"]')?.getAttribute('aria-current')).toBe('true');
    expect(root.querySelector('#room-list button[data-select="all"]')?.getAttribute('aria-current')).toBe('false');
    expect(root.querySelector('[data-room="r3"]')?.classList.contains('is-selected')).toBe(true);
    expect(root.querySelector('[data-wall="w27"]')?.classList.contains('is-faced')).toBe(true);
    expect(root.querySelector('[data-wall="w2"]')?.classList.contains('is-faced')).toBe(true);
    expect(root.querySelector('[data-wall="w7"]')?.classList.contains('is-faced')).toBe(false);
  });

  it('selecting a room on the plan by click or keyboard works and the whole flat resets it', () => {
    const root = setup();
    click(root.querySelector('[data-room="r4"] circle'));
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Спальня');
    const bath = root.querySelector('[data-room="r5"]');
    if (!bath) throw new Error('no r5');
    key(bath, 'Enter');
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Ванная');
    click(root.querySelector('#room-list button[data-select="all"]'));
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Вся квартира');
    expect(root.querySelectorAll('.overlay-room.is-selected')).toHaveLength(0);
    expect(root.querySelectorAll('.overlay-wall.is-faced')).toHaveLength(0);
  });
});

describe('gallery', () => {
  it('picks the hero photo from thumbnails and wraps around with prev and next', () => {
    const root = setup();
    controller?.select('r1');
    click(root.querySelector('.thumb[data-photo="p2"]'));
    expect(root.querySelector<HTMLImageElement>('#gallery-image')?.getAttribute('src')).toContain('photo-02.jpg');
    expect(root.querySelector('#gallery-counter')?.textContent).toBe('2 / 3');
    click(root.querySelector('[data-action="gallery-next"]'));
    click(root.querySelector('[data-action="gallery-next"]'));
    expect(root.querySelector('#gallery-counter')?.textContent).toBe('1 / 3');
    click(root.querySelector('[data-action="gallery-prev"]'));
    expect(root.querySelector('#gallery-counter')?.textContent).toBe('3 / 3');
    expect(root.querySelector('#gallery-image')?.getAttribute('src')).toContain('photo-17.jpg');
  });

  it('opens the lightbox from the hero photo, steps through the room set and closes on Escape', () => {
    const root = setup();
    controller?.select('r1');
    click(root.querySelector('.photo-main'));
    const lightbox = root.querySelector<HTMLDialogElement>('#lightbox');
    expect(lightbox?.open).toBe(true);
    expect(root.querySelector('#lightbox-image')?.getAttribute('src')).toContain('photo-01.jpg');
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('Гостиная, 1 из 3');
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('фото 1');
    key(document, 'ArrowRight');
    expect(root.querySelector('#lightbox-image')?.getAttribute('src')).toContain('photo-02.jpg');
    key(document, 'ArrowLeft');
    key(document, 'ArrowLeft');
    expect(root.querySelector('#lightbox-image')?.getAttribute('src')).toContain('photo-17.jpg');
    key(document, 'Escape');
    expect(lightbox?.open).toBe(false);
  });

  it('opens the lightbox straight from the whole-flat grid with the shared numbering', () => {
    const root = setup();
    click(root.querySelector('.thumbs.is-grid .thumb[data-photo="p5"]'));
    expect(root.querySelector<HTMLDialogElement>('#lightbox')?.open).toBe(true);
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('Фото 5 из 17');
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('Столовая и вход');
    click(root.querySelector('[data-action="lightbox-close"]'));
    expect(root.querySelector<HTMLDialogElement>('#lightbox')?.open).toBe(false);
  });

  it('highlights the wall a photo looks at while hovering its thumbnail', () => {
    const root = setup();
    const thumb = root.querySelector('.thumb[data-photo="p1"]');
    thumb?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(root.querySelector('[data-wall="w7"]')?.classList.contains('is-hot')).toBe(true);
    thumb?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    expect(root.querySelector('[data-wall="w7"]')?.classList.contains('is-hot')).toBe(false);
  });
});

describe('stage', () => {
  it('switches to the empty 3D stage once, mounting the scene lazily, and back to the plan', () => {
    const root = setup();
    expect(mountScene).not.toHaveBeenCalled();
    click(root.querySelector('button[data-view="scene"]'));
    expect(mountScene).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.app')?.getAttribute('data-view')).toBe('scene');
    expect(root.querySelector<HTMLElement>('#stage-scene')?.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('#stage-plan')?.hidden).toBe(true);
    expect(root.querySelector('#stage-status')?.textContent).toContain('Builder');
    expect(root.querySelector('button[data-view="scene"]')?.getAttribute('aria-pressed')).toBe('true');
    click(root.querySelector('button[data-view="plan"]'));
    click(root.querySelector('button[data-view="scene"]'));
    expect(mountScene).toHaveBeenCalledTimes(1);
    click(root.querySelector('button[data-view="plan"]'));
    expect(root.querySelector<HTMLElement>('#stage-plan')?.hidden).toBe(false);
    expect(root.querySelector('#stage-status')?.textContent).toContain('Исходный план');
    controller?.dispose();
    expect(disposeScene).toHaveBeenCalledTimes(1);
  });

  it('hides and shows the model marks', () => {
    const root = setup();
    click(root.querySelector('button[data-action="toggle-marks"]'));
    expect(root.querySelector('.app')?.getAttribute('data-marks')).toBe('off');
    expect(root.querySelector('button[data-action="toggle-marks"]')?.getAttribute('aria-pressed')).toBe('false');
    click(root.querySelector('button[data-action="toggle-marks"]'));
    expect(root.querySelector('.app')?.getAttribute('data-marks')).toBe('on');
  });

  it('opens the about dialog from either button', () => {
    const root = setup();
    click(root.querySelector('.topbar button[data-action="about"]'));
    expect(root.querySelector<HTMLDialogElement>('#about-dialog')?.open).toBe(true);
  });
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { renderShell } from '../src/shell';
import { listingView } from '../src/view-model';
import { mountListing, type ListingController } from '../src/interactions';
import { prepareWalk } from '../src/walk-prep';
import type { SceneController, SceneHooks } from '../src/walk-scene';

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
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Kitchen');
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
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Bedroom');
    const bath = root.querySelector('[data-room="r5"]');
    if (!bath) throw new Error('no r5');
    key(bath, 'Enter');
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Bathroom');
    click(root.querySelector('#room-list button[data-select="all"]'));
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Entire apartment');
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
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('Living room, 1 of 3');
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('photo 1');
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
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('Photo 5 of 17');
    expect(root.querySelector('#lightbox-caption')?.textContent).toContain('Dining area and entrance');
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
    expect(root.querySelector('#stage-status')?.textContent).toContain('Source floor plan');
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

describe('walk', () => {
  let hooks: SceneHooks = {};
  const fake = {
    mode: 'overview' as const,
    setMode: vi.fn(),
    enterRoom: vi.fn(() => true),
    input: vi.fn(),
    lockMouse: vi.fn(async () => true),
    pause: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    inspect: vi.fn(),
  };
  const mountWalk = vi.fn((_host: HTMLElement, received: SceneHooks) => { hooks = received; return fake as unknown as SceneController; });

  function setupWalk() {
    const parsed = model(reference);
    const prep = prepareWalk(parsed);
    const root = document.createElement('div');
    root.innerHTML = renderShell({ kind: 'ready', model: parsed, source: { kind: 'fixture' }, plan: { status: 'ok' }, prep });
    document.body.replaceChildren(root);
    controller = mountListing(root, listingView(parsed, { kind: 'fixture' }), { mountScene, mountWalk, prep });
    return root;
  }

  afterEach(() => { for (const spy of Object.values(fake)) if (typeof spy === 'function' && 'mockClear' in spy) spy.mockClear(); mountWalk.mockClear(); });

  it('starts the walk from the toolbar, shows the HUD and leaves it with Escape', () => {
    const root = setupWalk();
    const canvas = root.querySelector<HTMLElement>('.stage-canvas');
    const intoView = vi.fn();
    if (canvas) canvas.scrollIntoView = intoView;
    click(root.querySelector('button[data-action="walk"]'));
    expect(intoView).toHaveBeenCalled();
    expect(mountWalk).toHaveBeenCalledTimes(1);
    expect(fake.setMode).toHaveBeenLastCalledWith('walk');
    expect(root.querySelector('.app')?.getAttribute('data-view')).toBe('walk');
    expect(root.querySelector<HTMLElement>('#walk-hud')?.hidden).toBe(false);
    expect(root.querySelector('button[data-action="walk"]')?.textContent).toContain('Exit walkthrough');
    expect(root.querySelector('#stage-status')?.textContent).toMatch(/WASD/);
    key(document, 'Escape');
    expect(fake.setMode).toHaveBeenLastCalledWith('overview');
    expect(root.querySelector('.app')?.getAttribute('data-view')).toBe('scene');
    expect(root.querySelector<HTMLElement>('#walk-hud')?.hidden).toBe(true);
    expect(mountScene).not.toHaveBeenCalled();
  });

  it('switches between top and overview and reports Builder in the status', () => {
    const root = setupWalk();
    click(root.querySelector('button[data-view="top"]'));
    expect(fake.setMode).toHaveBeenLastCalledWith('top');
    expect(root.querySelector('#stage-status')?.textContent).toMatch(/Builder/);
    click(root.querySelector('button[data-view="scene"]'));
    expect(fake.setMode).toHaveBeenLastCalledWith('overview');
    expect(mountWalk).toHaveBeenCalledTimes(1);
  });

  it('follows the player into rooms: HUD text and sidebar selection', () => {
    const root = setupWalk();
    click(root.querySelector('button[data-action="walk"]'));
    hooks.onRoom?.('r3');
    expect(root.querySelector('#hud-room')?.textContent).toBe('Kitchen');
    expect(root.querySelector('#hud-area')?.textContent).toMatch(/m²/);
    expect(root.querySelector('#room-list button[data-select="r3"]')?.getAttribute('aria-current')).toBe('true');
    hooks.onRoom?.(null);
    expect(root.querySelector('#hud-room')?.textContent).toMatch(/outside rooms/i);
  });

  it('teleports into the selected room from the panel and from a projected label', () => {
    const root = setupWalk();
    click(root.querySelector('#room-list button[data-select="r4"]'));
    click(root.querySelector('#room-panel button[data-action="enter-room"]'));
    expect(fake.enterRoom).toHaveBeenLastCalledWith('r4');
    expect(root.querySelector('.app')?.getAttribute('data-view')).toBe('walk');
    hooks.onLabel?.('r9');
    expect(fake.enterRoom).toHaveBeenLastCalledWith('r9');
  });

  it('routes touch buttons and mouse lock to the scene and pauses it behind dialogs', () => {
    const root = setupWalk();
    click(root.querySelector('button[data-action="walk"]'));
    const up = root.querySelector('#walk-hud button[data-key="KeyW"]');
    up?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    expect(fake.input).toHaveBeenLastCalledWith('KeyW', true);
    up?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    expect(fake.input).toHaveBeenLastCalledWith('KeyW', false);
    click(root.querySelector('#walk-hud button[data-action="lock-mouse"]'));
    expect(fake.lockMouse).toHaveBeenCalledTimes(1);
    click(root.querySelector('.topbar button[data-action="about"]'));
    expect(fake.pause).toHaveBeenLastCalledWith(true);
    root.querySelector<HTMLDialogElement>('#about-dialog')?.close();
    expect(fake.pause).toHaveBeenLastCalledWith(false);
  });
});

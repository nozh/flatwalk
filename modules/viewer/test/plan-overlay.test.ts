import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { buildOverlay, renderOverlaySvg } from '../src/plan-overlay';
import { listingView } from '../src/view-model';

const dir = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));
const synthetic = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error('invalid test model');
  return parsed.data;
}

function overlayFor(raw: unknown, planAvailable = true) {
  const parsed = model(raw);
  const view = listingView(parsed, { kind: 'fixture' });
  return buildOverlay(parsed, view.plan, planAvailable);
}

describe('buildOverlay', () => {
  it('maps metres to plan pixels through pxPerMeter', () => {
    const overlay = overlayFor(reference);
    expect(overlay.mode).toBe('plan');
    expect(overlay.viewBox).toEqual([0, 0, 940, 786]);
    expect(overlay.image).toEqual({ url: '/fixtures/54541/plan.png', width: 940, height: 786 });
    const w1 = overlay.walls.find((wall) => wall.id === 'w1');
    expect(w1?.x1).toBeCloseTo(9, 0);
    expect(w1?.y1).toBeCloseTo(94, 0);
    expect(w1?.width).toBeCloseTo(17.2, 0);
    expect(w1?.exterior).toBe(true);
    const living = overlay.rooms.find((room) => room.id === 'r1');
    expect(living?.label).toBe('Гостиная');
    expect(living?.x).toBeCloseTo(738, 0);
    expect(living?.y).toBeCloseTo(433, 0);
  });

  it('places openings along their wall from vertex a and keeps door flags', () => {
    const overlay = overlayFor(reference);
    const entrance = overlay.openings.find((opening) => opening.id === 'o10');
    expect(entrance).toMatchObject({ kind: 'door', entrance: true, passable: true });
    expect(entrance?.x1).toBeCloseTo(388, 0);
    expect(entrance?.x2).toBeCloseTo(302, 0);
    expect(entrance?.y1).toBeCloseTo(534, 0);
    const terrace = overlay.openings.find((opening) => opening.id === 'o12');
    expect(terrace).toMatchObject({ kind: 'door', entrance: false, passable: false });
    expect(overlay.openings.filter((opening) => opening.kind === 'window')).toHaveLength(8);
  });

  it('shows only the picture when the model has no scale yet', () => {
    const raw = structuredClone(synthetic);
    delete raw.plan.pxPerMeter;
    const overlay = overlayFor(raw);
    expect(overlay.mode).toBe('plan-only');
    expect(overlay.walls).toEqual([]);
    expect(overlay.rooms).toEqual([]);
    expect(overlay.image?.url).toBe('/fixtures/54541/materials/plan.png');
  });

  it('draws a wall scheme in its own frame when the plan picture is unavailable', () => {
    const overlay = overlayFor(synthetic, false);
    expect(overlay.mode).toBe('scheme');
    expect(overlay.image).toBeNull();
    expect(overlay.walls).toHaveLength(1);
    expect(overlay.rooms).toHaveLength(2);
    const [x, y, w, h] = overlay.viewBox;
    expect(x).toBeLessThan(0);
    expect(y).toBeLessThan(0);
    expect(w).toBeGreaterThan(400);
    expect(h).toBeGreaterThan(300);
  });

  it('is empty without a picture and without walls', () => {
    const raw = structuredClone(synthetic);
    raw.walls = {};
    raw.vertices = {};
    raw.openings = {};
    const overlay = overlayFor(raw, false);
    expect(overlay.mode).toBe('empty');
  });
});

describe('renderOverlaySvg', () => {
  it('renders the picture, labelled room anchors, walls and the entrance without exposing ids as text', () => {
    const svg = renderOverlaySvg(overlayFor(reference));
    const host = document.createElement('div');
    host.innerHTML = svg;
    const root = host.querySelector('svg');
    expect(root?.getAttribute('viewBox')).toBe('0 0 940 786');
    expect(host.querySelector('image')?.getAttribute('href')).toBe('/fixtures/54541/plan.png');
    expect(host.querySelectorAll('[data-room]')).toHaveLength(10);
    expect(host.querySelector('[data-room="r1"]')?.textContent).toContain('Гостиная');
    expect(host.querySelectorAll('[data-wall]')).toHaveLength(34);
    expect(host.querySelectorAll('.overlay-opening.is-door')).toHaveLength(12);
    expect(host.querySelectorAll('.overlay-opening.is-window')).toHaveLength(8);
    expect(host.querySelector('.overlay-entrance')?.textContent).toContain('entrance');
    expect(host.textContent).not.toMatch(/\b[rwov]\d+\b/);
  });

  it('marks the selected room and faced walls through classes only', () => {
    const svg = renderOverlaySvg(overlayFor(reference), { selectedRoom: 'r3', facedWalls: ['w27'] });
    const host = document.createElement('div');
    host.innerHTML = svg;
    expect(host.querySelector('[data-room="r3"]')?.classList.contains('is-selected')).toBe(true);
    expect(host.querySelector('[data-room="r1"]')?.classList.contains('is-selected')).toBe(false);
    expect(host.querySelector('[data-wall="w27"]')?.classList.contains('is-faced')).toBe(true);
  });
});

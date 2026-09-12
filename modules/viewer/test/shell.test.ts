import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { renderShell } from '../src/shell';
import { prepareWalk } from '../src/walk-prep';

const dir = dirname(fileURLToPath(import.meta.url));
const synthetic = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8'));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error('invalid test model');
  return parsed.data;
}

function mount(html: string) {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe('renderShell', () => {
  it('shows a loading state', () => {
    const root = mount(renderShell({ kind: 'loading' }));
    expect(root.textContent).toContain('Loading model');
  });

  it('explains a missing static file and offers the bundled reference', () => {
    const root = mount(renderShell({ kind: 'missing', source: { kind: 'static' }, url: '/model/latest.json' }));
    expect(root.textContent).toContain('Model not found');
    expect(root.textContent).toContain('/model/latest.json');
    expect(root.querySelector('a[href="?src=fixture"]')).not.toBeNull();
    expect(root.querySelector('button[data-action="reload"]')).not.toBeNull();
  });

  it('explains a missing 54541 fixture without treating the synthetic test as that listing', () => {
    const root = mount(renderShell({ kind: 'missing', source: { kind: 'fixture' }, url: '/fixtures/54541/flat.model.json' }));
    expect(root.textContent).toContain('Reference model 54541 is unavailable');
    expect(root.textContent).not.toContain('viewer-synthetic');
    expect(root.querySelector('a[href="./"]')).not.toBeNull();
  });

  it('shows contract issues for an invalid model behind a details toggle', () => {
    const root = mount(renderShell({ kind: 'invalid', issues: ['schemaVersion: Invalid', 'rooms.r1.anchor: Required'] }));
    expect(root.textContent).toContain('Model validation failed');
    expect(root.textContent).toContain('2');
    expect(root.querySelector('details')?.textContent).toContain('schemaVersion: Invalid');
  });

  it('renders id, rooms, the empty-scene notice and a plan-unavailable fallback', () => {
    const root = mount(renderShell({ kind: 'ready', model: model(synthetic), source: { kind: 'static' }, plan: { status: 'unavailable' } }));
    expect(root.textContent).toContain('viewer-synthetic');
    expect(root.textContent).toContain('Living room');
    expect(root.textContent).toContain('Kitchen');
    expect(root.textContent).toContain('The 3D scene has not been built');
    expect(root.textContent).toContain('The source floor plan is unavailable');
    expect(root.querySelector('#scene-slot')).not.toBeNull();
    expect(root.textContent).toContain('Static mode');
    expect(root.querySelector('svg.plan-overlay.is-scheme')).not.toBeNull();
  });

  it('builds the full listing screen for the reference without technical ids in the main areas', () => {
    const root = mount(renderShell({ kind: 'ready', model: model(reference), source: { kind: 'fixture' }, plan: { status: 'ok' }, report: { status: 'missing', url: '/x' } }));
    expect(root.querySelector('h1')?.textContent).toBe('Apartment 105 m²');
    expect(root.querySelector('svg.plan-overlay.is-plan image')?.getAttribute('href')).toBe('/fixtures/54541/plan.png');
    expect(root.querySelectorAll('#room-list button[data-select]')).toHaveLength(11);
    expect(root.querySelector('#room-panel h2')?.textContent).toBe('Entire apartment');
    expect(root.querySelector('button[data-view="scene"]')).not.toBeNull();
    expect(root.querySelector('button[data-action="toggle-marks"]')?.getAttribute('aria-pressed')).toBe('true');
    const walk = root.querySelector<HTMLButtonElement>('button[data-action="walk"]');
    expect(walk?.disabled).toBe(true);
    expect(root.querySelector('dialog#about-dialog')).not.toBeNull();
    expect(root.querySelector('dialog#lightbox')).not.toBeNull();
    const main = root.querySelector('main');
    expect(main?.textContent).not.toMatch(/\b[rwop]\d+\b/);
    expect(main?.textContent).not.toContain('cityexpert-54541');
    expect(root.querySelector('a[href^="https://cityexpert.rs"]')?.getAttribute('target')).toBe('_blank');
  });
});

describe('renderShell with Builder and Geometry Core prepared', () => {
  it('enables the walk, offers top and overview views and lists geometry diagnostics', () => {
    const parsed = model(reference);
    const root = mount(renderShell({ kind: 'ready', model: parsed, source: { kind: 'fixture' }, plan: { status: 'ok' }, prep: prepareWalk(parsed) }));
    const walk = root.querySelector<HTMLButtonElement>('button[data-action="walk"]');
    expect(walk?.disabled).toBe(false);
    expect(root.querySelector('#walk-hint')?.textContent).toMatch(/WASD/);
    expect(root.querySelector('button[data-view="top"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[data-view="scene"]')?.disabled).toBe(false);
    expect(root.querySelector<HTMLElement>('#walk-hud')?.hidden).toBe(true);
    expect(root.querySelectorAll('#walk-hud button[data-key]')).toHaveLength(6);
    expect(root.querySelector('#walk-hud button[data-action="lock-mouse"]')).not.toBeNull();
    expect(root.querySelectorAll('.about-geometry li').length).toBeGreaterThanOrEqual(4);
    expect(root.querySelector('.about-geometry')?.textContent).toContain('walkthrough is available');
    expect(root.querySelector('.scene-empty')).toBeNull();
  });

  it('keeps the scene views but disables the walk with the reason when there is no start', () => {
    const parsed = model(synthetic);
    const root = mount(renderShell({ kind: 'ready', model: parsed, source: { kind: 'static' }, plan: { status: 'unavailable' }, prep: prepareWalk(parsed) }));
    expect(root.querySelector<HTMLButtonElement>('button[data-action="walk"]')?.disabled).toBe(true);
    expect(root.querySelector('#walk-hint')?.textContent).toMatch(/entrance|start/i);
    expect(root.querySelector<HTMLButtonElement>('button[data-view="top"]')?.disabled).toBe(false);
    expect(root.querySelector('.about-geometry')?.textContent).toMatch(/unavailable/i);
  });

  it('disables the top view and the walk without a prepared scene but keeps the overview as an empty stage', () => {
    const root = mount(renderShell({ kind: 'ready', model: model(synthetic), source: { kind: 'static' }, plan: { status: 'unavailable' } }));
    expect(root.querySelector<HTMLButtonElement>('button[data-view="top"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[data-view="scene"]')?.disabled).toBe(false);
    expect(root.querySelector<HTMLButtonElement>('button[data-action="walk"]')?.disabled).toBe(true);
    expect(root.textContent).toContain('The 3D scene has not been built');
  });
});

describe('renderShell with a validation report', () => {
  it('labels the walk as a trial and shows the report status in the HUD when clearance was skipped', () => {
    const parsed = model(reference);
    const report = {
      status: 'ok' as const, url: '/validation/rev-000.json',
      report: {
        schemaVersion: '0.1' as const, modelId: 'cityexpert-54541', revision: 0, walkReady: true, confirmation: 0.9,
        checks: [
          { checkId: 'navigation.reachable', layer: 'navigation' as const, status: 'pass' as const, severity: 'error' as const, entities: [], message: 'ok' },
          { checkId: 'navigation.start', layer: 'navigation' as const, status: 'pass' as const, severity: 'error' as const, entities: [], message: 'ok' },
          { checkId: 'navigation.clearance', layer: 'navigation' as const, status: 'skipped' as const, severity: 'info' as const, entities: [], message: 'не проверялся' },
        ],
        review: { items: [] },
      },
    };
    const root = mount(renderShell({ kind: 'ready', model: parsed, source: { kind: 'fixture' }, plan: { status: 'ok' }, prep: prepareWalk(parsed), report }));
    expect(root.querySelector<HTMLButtonElement>('button[data-action="walk"]')?.disabled).toBe(false);
    expect(root.querySelector('button[data-action="walk"]')?.textContent).toContain('Trial walkthrough');
    expect(root.querySelector('#walk-hint')?.textContent).toContain('clearance is unverified');
    expect(root.querySelector('#hud-verification')?.textContent).toContain('Room connectivity is verified. Clearance is not verified.');
  });

  it('does not call the walkthrough ready and keeps overview when geometry checks failed', () => {
    const parsed = model(reference);
    const report = {
      status: 'ok' as const, url: 'job:x',
      report: {
        schemaVersion: '0.1' as const, modelId: parsed.id, revision: parsed.revision, walkReady: false, confirmation: 0.1,
        checks: [
          { checkId: 'navigation.reachable', layer: 'navigation' as const, status: 'fail' as const, severity: 'error' as const, entities: [], message: 'kitchen is unreachable' },
          { checkId: 'navigation.start', layer: 'navigation' as const, status: 'pass' as const, severity: 'error' as const, entities: [], message: 'ok' },
          { checkId: 'navigation.clearance', layer: 'navigation' as const, status: 'skipped' as const, severity: 'info' as const, entities: [], message: 'skipped' },
        ],
        review: { items: [] },
      },
    };
    const root = mount(renderShell({
      kind: 'ready',
      model: parsed,
      source: { kind: 'job', origin: 'http://127.0.0.1:8787', jobId: 'x' },
      plan: { status: 'unavailable' },
      prep: prepareWalk(parsed),
      report,
      syntheticFixture: true,
    }));
    expect(root.textContent).toMatch(/Synthetic fixture geometry/);
    expect(root.textContent).not.toMatch(/Walkthrough is ready/i);
    expect(root.querySelector('button[data-action="walk"]')?.textContent).toContain('Trial walkthrough');
    expect(root.querySelector<HTMLButtonElement>('button[data-action="walk"]')?.disabled).toBe(true);
    expect(root.querySelector<HTMLButtonElement>('button[data-view="scene"]')?.disabled).toBe(false);
    expect(root.querySelector('#about-dialog')?.textContent).toMatch(/source materials only/i);
  });
});

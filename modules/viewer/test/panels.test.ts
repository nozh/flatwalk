import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { listingView } from '../src/view-model';
import { renderAbout, renderAssumptionStrip, renderRoomList, renderRoomPanel, renderStageStatus } from '../src/panels';

const dir = dirname(fileURLToPath(import.meta.url));
const reference = JSON.parse(readFileSync(join(dir, '../../../fixtures/54541/flat.model.json'), 'utf8'));
const synthetic = JSON.parse(readFileSync(join(dir, 'fixtures/viewer-synthetic.model.json'), 'utf8'));

function model(raw: unknown): FlatModel {
  const parsed = validateFlatModel(raw);
  if (!parsed.success) throw new Error('invalid test model');
  return parsed.data;
}
function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}
const view = listingView(model(reference), { kind: 'fixture' });

describe('renderRoomList', () => {
  it('lists the whole flat first, then rooms with photo counts and question marks, without ids', () => {
    const host = mount(renderRoomList(view, 'r6'));
    const buttons = host.querySelectorAll('button[data-select]');
    expect(buttons).toHaveLength(11);
    expect(buttons[0]?.getAttribute('data-select')).toBe('all');
    expect(buttons[0]?.textContent).toContain('Вся квартира');
    expect(buttons[0]?.textContent).toContain('17');
    const living = host.querySelector('button[data-select="r1"]');
    expect(living?.textContent).toContain('Гостиная');
    expect(living?.textContent).toContain('3');
    expect(host.querySelector('button[data-select="r6"]')?.getAttribute('aria-current')).toBe('true');
    expect(living?.getAttribute('aria-current')).toBe('false');
    expect(host.querySelector('button[data-select="r6"] .room-question')).not.toBeNull();
    expect(host.querySelector('button[data-select="r1"] .room-question')).toBeNull();
    expect(host.textContent).not.toMatch(/\b[rwop]\d+\b/);
  });
});

describe('renderRoomPanel', () => {
  it('describes the whole flat from declared data and shows every photo', () => {
    const host = mount(renderRoomPanel(view, 'all'));
    expect(host.querySelector('h2')?.textContent).toBe('Вся квартира');
    expect(host.textContent).toContain('105 м²');
    expect(host.textContent).toContain('3,5');
    expect(host.textContent).toContain('10 помещений');
    expect(host.textContent).toContain('17 фотографий');
    expect(host.querySelectorAll('button[data-photo]')).toHaveLength(17);
    expect(host.querySelector('button[data-photo="p1"] img')?.getAttribute('alt')).toBe('Фото 1, Гостиная');
    expect(host.querySelector('button[data-photo="p1"]')?.getAttribute('data-faces')).toBe('w7');
  });

  it('describes a room with its origin and confidence and lists only its photos', () => {
    const host = mount(renderRoomPanel(view, 'r1'));
    expect(host.querySelector('h2')?.textContent).toBe('Гостиная');
    expect(host.textContent).toContain('жилая комната');
    expect(host.textContent).toMatch(/выведено из плана/i);
    expect(host.textContent).toContain('90 %');
    expect(host.querySelectorAll('.thumb[data-photo]')).toHaveLength(3);
    expect(host.querySelector('.photo-main[data-photo="p1"] img')?.getAttribute('src')).toBe('/fixtures/54541/photos/photo-01.jpg');
    expect(host.querySelector('#gallery-counter')?.textContent).toBe('1 / 3');
    expect(host.querySelector('.thumb[data-photo="p1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).not.toContain('Вопрос');
  });

  it('shows the model question and an honest empty gallery for a room without photos', () => {
    const host = mount(renderRoomPanel(view, 'r6'));
    expect(host.querySelector('h2')?.textContent).toBe('Коридор');
    expect(host.textContent).toContain('узкий коридор');
    expect(host.querySelectorAll('button[data-photo]')).toHaveLength(0);
    expect(host.textContent).toContain('фотографии не привязаны');
  });

  it('falls back to the shared gallery when the model binds no photo to rooms', () => {
    const raw = structuredClone(reference);
    for (const asset of Object.values(raw.assets) as { kind: string; room?: string | null; faces?: string | null }[]) {
      if (asset.kind === 'photo') { asset.room = null; asset.faces = null; }
    }
    const unbound = listingView(model(raw), { kind: 'fixture' });
    const room = mount(renderRoomPanel(unbound, 'r1'));
    expect(room.textContent).toContain('не привязаны к помещениям');
    expect(room.querySelector('button[data-select="all"]')).not.toBeNull();
    expect(room.querySelectorAll('button[data-photo]')).toHaveLength(0);
    const all = mount(renderRoomPanel(unbound, 'all'));
    expect(all.querySelectorAll('button[data-photo]')).toHaveLength(17);
  });

  it('says plainly when the model has no photos at all', () => {
    const host = mount(renderRoomPanel(listingView(model(synthetic), { kind: 'static' }), 'all'));
    expect(host.textContent).toContain('нет фотографий');
    expect(host.querySelectorAll('button[data-photo]')).toHaveLength(0);
  });
});

describe('renderAssumptionStrip', () => {
  it('states scale, ceiling default, open questions and the missing verification', () => {
    const host = mount(renderAssumptionStrip(view, { status: 'missing', url: '/x' }));
    expect(host.textContent).toContain('подобран по заявленной площади');
    expect(host.textContent).toContain('70 %');
    expect(host.textContent).toContain('2,8 м');
    expect(host.textContent).toContain('по умолчанию');
    expect(host.textContent).toContain('6');
    expect(host.textContent).toMatch(/не проверен/);
    expect(host.querySelector('button[data-action="about"]')).not.toBeNull();
  });

  it('says the scale is undefined and skips the question count when there are none', () => {
    const raw = structuredClone(synthetic);
    delete raw.plan.pxPerMeter;
    const host = mount(renderAssumptionStrip(listingView(model(raw), { kind: 'static' }), { status: 'missing', url: '/x' }));
    expect(host.textContent).toContain('Масштаб плана не определён');
    expect(host.textContent).not.toContain('вопрос');
  });
});

describe('renderAbout', () => {
  it('explains source, producers, defaults, questions, verification and the static mode', () => {
    const host = mount(renderAbout(view, { status: 'missing', url: '/x' }, { kind: 'fixture' }));
    expect(host.textContent).toContain('CityExpert');
    expect(host.textContent).toContain('12 сентября 2026');
    expect(host.querySelector('a[href^="https://cityexpert.rs"]')?.getAttribute('rel')).toContain('noopener');
    expect(host.textContent).toContain('ручная разметка эталона');
    expect(host.querySelectorAll('.about-defaults li')).toHaveLength(4);
    expect(host.querySelectorAll('.about-questions li')).toHaveLength(6);
    expect(host.textContent).toContain('Помещение «Коридор»');
    expect(host.textContent).toContain('Отчёт');
    expect(host.textContent).toMatch(/не проверен/);
    expect(host.textContent).toMatch(/правки не сохраняются/i);
    expect(host.textContent).toContain('cityexpert-54541');
  });

  it('summarises a real validation report without claiming more than it says', () => {
    const report = {
      status: 'ok' as const,
      url: '/validation/rev-000.json',
      report: {
        schemaVersion: '0.1' as const, modelId: 'cityexpert-54541', revision: 0, walkReady: false, confirmation: 0.35,
        checks: [
          { checkId: 'contract.schema', layer: 'contract' as const, status: 'pass' as const, severity: 'error' as const, entities: [], message: 'Схема соблюдена' },
          { checkId: 'navigation.reach', layer: 'navigation' as const, status: 'fail' as const, severity: 'error' as const, entities: ['rooms.r6'], message: 'Комната недостижима от входа' },
          { checkId: 'scale.doors', layer: 'scale' as const, status: 'unverified' as const, severity: 'warning' as const, entities: [], message: 'Ширина дверей не проверялась' },
        ],
        review: { items: [{ id: 'q1', path: 'rooms.r2', severity: 'warning' as const, reason: 'низкая уверенность' }] },
      },
    };
    const host = mount(renderAbout(view, report, { kind: 'static' }));
    expect(host.textContent).toContain('не готова');
    expect(host.textContent).toContain('35 %');
    expect(host.textContent).toContain('Комната недостижима от входа');
    expect(host.textContent).toContain('низкая уверенность');
    expect(host.textContent).toContain('1 пройдена');
    expect(host.textContent).toContain('1 не пройдена');
    expect(host.textContent).toContain('1 не проверена');
  });
});

describe('renderStageStatus', () => {
  it('tells the truth about what the stage shows', () => {
    expect(renderStageStatus('plan', 'plan')).toContain('3D-сцена ещё не построена');
    expect(renderStageStatus('plan', 'scheme')).toContain('Исходный план недоступен');
    expect(renderStageStatus('plan', 'plan-only')).toContain('масштаб');
    expect(renderStageStatus('scene', 'plan')).toContain('Builder');
  });
});

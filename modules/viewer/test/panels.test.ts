import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { listingView } from '../src/view-model';
import { renderAbout, renderAssumptionStrip, renderRoomList, renderRoomPanel, renderStageStatus } from '../src/panels';
import { prepareWalk } from '../src/walk-prep';
import type { ReportResult } from '../src/load-report';

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
          { checkId: 'navigation.reachable', layer: 'navigation' as const, status: 'fail' as const, severity: 'error' as const, entities: ['rooms.r6'], message: 'Комната недостижима от входа' },
          { checkId: 'scale.doors', layer: 'scale' as const, status: 'unverified' as const, severity: 'warning' as const, entities: [], message: 'Ширина дверей не проверялась' },
        ],
        review: { items: [{ id: 'q1', path: 'rooms.r2', severity: 'warning' as const, reason: 'низкая уверенность' }] },
      },
    };
    const host = mount(renderAbout(view, report, { kind: 'static' }));
    expect(host.textContent).toContain('Геометрия не подтверждена: связность комнат не пройдена. Ширина проходов не проверена.');
    expect(host.textContent).not.toMatch(/прогулка готова/i);
    expect(host.textContent).toContain('Подтверждённых сведений модели: 35 %');
    expect(host.textContent).toContain('доля сущностей, подтверждённых человеком или с уверенностью не ниже 0,6');
    expect(host.textContent).not.toMatch(/35 % проверок/);
    expect(host.querySelector('.about-failed')?.textContent).toContain('Комната недостижима от входа');
    expect(host.querySelector('.about-unverified')?.textContent).toContain('Ширина дверей не проверялась');
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

describe('renderRoomPanel with a walk available', () => {
  it('offers to enter the room only when the walk can start there', () => {
    const withWalk = mount(renderRoomPanel(view, 'r1', { walkable: (id) => id === 'r1' }));
    expect(withWalk.querySelector('button[data-action="enter-room"]')?.getAttribute('data-room')).toBe('r1');
    const noPolygon = mount(renderRoomPanel(view, 'r6', { walkable: () => false }));
    expect(noPolygon.querySelector('button[data-action="enter-room"]')).toBeNull();
    const plain = mount(renderRoomPanel(view, 'r1'));
    expect(plain.querySelector('button[data-action="enter-room"]')).toBeNull();
    expect(mount(renderRoomPanel(view, 'all', { walkable: () => true })).querySelector('button[data-action="enter-room"]')).toBeNull();
  });
});

const trialReport: ReportResult = {
  status: 'ok', url: '/validation/rev-000.json',
  report: {
    schemaVersion: '0.1', modelId: 'cityexpert-54541', revision: 0, walkReady: true, confirmation: 0.92,
    checks: [
      { checkId: 'navigation.reachable', layer: 'navigation', status: 'pass', severity: 'error', entities: [], message: 'Все комнаты достижимы от r2 по проходимым дверям.' },
      { checkId: 'navigation.start', layer: 'navigation', status: 'pass', severity: 'error', entities: [], message: 'Старт 1 м внутрь от входа лежит в комнате.' },
      { checkId: 'navigation.clearance', layer: 'navigation', status: 'skipped', severity: 'info', entities: [], message: 'Проход ≥ 0.6 м с учётом радиуса аватара 0.25 м не проверялся.' },
      { checkId: 'scale.doors', layer: 'scale', status: 'unverified', severity: 'warning', entities: [], message: 'Ширина дверей не проверялась.' },
    ],
    review: { items: [{ id: 'q1', path: 'rooms.r6', severity: 'warning', reason: 'Комната r6 без фотографий' }] },
  },
};

describe('Validator messages in the about dialog', () => {
  it('replaces room ids in check and review messages with room names', () => {
    const about = mount(renderAbout(view, trialReport, { kind: 'fixture' }));
    expect(about.querySelector('.about-navigation')?.textContent).not.toContain('r2');
    expect(about.querySelector('.about-review')?.textContent).toContain('«Коридор»');
    expect(about.querySelector('.about-review')?.textContent).not.toMatch(/\br6\b/);
  });
});

describe('walk readiness wording from the report', () => {
  it('never announces a ready walk from walkReady alone in the strip, the stage status and the about dialog', () => {
    const strip = mount(renderAssumptionStrip(view, trialReport));
    expect(strip.textContent).toContain('Связность комнат проверена. Ширина проходов не проверена.');
    expect(strip.textContent).not.toMatch(/прогулка готова|прогулка возможна/i);
    const prep = prepareWalk(model(reference));
    const walkStatus = renderStageStatus('walk', 'plan', prep, 0, trialReport);
    expect(walkStatus).toContain('Пробная прогулка');
    expect(walkStatus).toContain('Ширина проходов не проверена');
    expect(renderStageStatus('top', 'plan', prep, 0, trialReport)).toContain('Пробная прогулка');
    const about = mount(renderAbout(view, trialReport, { kind: 'fixture' }, prep));
    const navigation = about.querySelector('.about-navigation')?.textContent ?? '';
    expect(navigation).toContain('Связность комнат: проверена.');
    expect(navigation).toContain('Ширина проходов: не проверена (пропущено).');
    expect(about.textContent).toContain('1 не проверена');
    expect(about.textContent).toContain('1 пропущена');
    expect(about.querySelector('.about-skipped')?.textContent).toContain('Проход ≥ 0.6 м с учётом радиуса аватара 0.25 м не проверялся.');
    expect(about.querySelector('.about-unverified')?.textContent).toContain('Ширина дверей не проверялась.');
    expect(about.textContent).toContain('Подтверждённых сведений модели: 92 %');
    expect(about.querySelector('.about-navigation')?.textContent).not.toMatch(/\br\d+\b/);
    expect(about.textContent).not.toMatch(/прогулка готова/i);
  });

  it('marks a report for another revision as not applicable', () => {
    const stale: ReportResult = { ...trialReport, status: 'stale' } as ReportResult;
    const strip = mount(renderAssumptionStrip(view, stale));
    expect(strip.textContent).toContain('другой модели или ревизии');
    const about = mount(renderAbout(view, stale, { kind: 'fixture' }));
    expect(about.textContent).toContain('другой модели или ревизии');
    expect(about.querySelector('.about-navigation')).toBeNull();
  });
});

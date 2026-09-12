import { describe, expect, it } from 'vitest';
import type { ValidationReport } from '@flatwalk/contract';
import { walkVerification } from '../src/report-status';
import type { ReportResult } from '../src/load-report';

type Check = ValidationReport['checks'][number];
const check = (checkId: string, status: Check['status'], message: string, layer: Check['layer'] = 'navigation'): Check =>
  ({ checkId, layer, status, severity: 'error', entities: [], message });

function report(overrides: Partial<ValidationReport>): ReportResult {
  const base: ValidationReport = {
    schemaVersion: '0.1', modelId: 'cityexpert-54541', revision: 0, walkReady: true, confirmation: 0.9,
    checks: [
      check('contract.schema', 'pass', 'Схема соблюдена', 'contract'),
      check('navigation.reachable', 'pass', 'Все комнаты достижимы от r2 по проходимым дверям.'),
      check('navigation.start', 'pass', 'Старт 1 м внутрь от входа лежит в комнате.'),
      { ...check('navigation.clearance', 'skipped', 'Проход ≥ 0.6 м с учётом радиуса аватара 0.25 м не проверялся.'), severity: 'info' },
    ],
    review: { items: [] },
  };
  return { status: 'ok', url: '/validation/rev-000.json', report: { ...base, ...overrides } };
}

describe('walkVerification', () => {
  it('does not promote walkReady with skipped clearance to a ready walk', () => {
    const status = walkVerification(report({}));
    expect(status.level).toBe('trial');
    expect(status.headline).toBe('Связность комнат проверена. Ширина проходов не проверена.');
    expect(status.headline).not.toMatch(/готов/);
    expect(status.lines).toContain('Связность комнат: проверена.');
    expect(status.lines).toContain('Старт от входа: проверен.');
    expect(status.lines).toContain('Ширина проходов: не проверена (пропущено).');
  });

  it('calls the walk ready only when clearance itself passed', () => {
    const status = walkVerification(report({
      checks: [
        check('navigation.reachable', 'pass', 'ok'),
        check('navigation.start', 'pass', 'ok'),
        check('navigation.clearance', 'pass', 'Проходы шире 0,6 м.'),
      ],
    }));
    expect(status.level).toBe('ready');
    expect(status.headline).toBe('Связность комнат и ширина проходов проверены. Прогулка готова.');
  });

  it('keeps a trial walk with reasons when the report says the geometry is not ready', () => {
    const status = walkVerification(report({
      walkReady: false,
      checks: [
        check('navigation.reachable', 'fail', 'Комната недостижима от входа: Коридор.'),
        check('navigation.start', 'pass', 'ok'),
        check('navigation.clearance', 'skipped', 'не проверялся'),
      ],
    }));
    expect(status.level).toBe('not-ready');
    expect(status.headline).toBe('Геометрия не подтверждена: связность комнат не пройдена. Ширина проходов не проверена.');
    expect(status.lines).toContain('Связность комнат: не пройдена. Комната недостижима от входа: Коридор.');
  });

  it('treats unverified navigation as unchecked, never as passed', () => {
    const status = walkVerification(report({
      walkReady: false,
      checks: [check('navigation.reachable', 'unverified', 'Навигация не считалась.'), check('navigation.start', 'unverified', 'нет')],
    }));
    expect(status.level).toBe('not-ready');
    expect(status.headline).toBe('Геометрия не подтверждена: связность комнат не проверена. Ширина проходов не проверена.');
  });

  it('explains a report for another model or revision and a missing report as unverified', () => {
    const stale = walkVerification({ ...report({ revision: 3 }), status: 'stale' } as ReportResult);
    expect(stale.level).toBe('none');
    expect(stale.headline).toBe('Отчёт проверки относится к другой модели или ревизии. Связность комнат и ширина проходов не проверены.');
    const missing = walkVerification({ status: 'missing', url: '/validation/rev-000.json' });
    expect(missing.level).toBe('none');
    expect(missing.headline).toBe('Отчёта Validator нет. Связность комнат и ширина проходов не проверены.');
    const invalid = walkVerification({ status: 'invalid', url: '/x', issues: ['walkReady: Invalid'] });
    expect(invalid.headline).toMatch(/не соответствует контракту/);
  });
});

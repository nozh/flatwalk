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
      check('contract.schema', 'pass', 'Schema holds', 'contract'),
      check('navigation.reachable', 'pass', 'All rooms are reachable from r2 through passable doors.'),
      check('navigation.start', 'pass', 'The start 1 m inside the entrance lies in a room.'),
      { ...check('navigation.clearance', 'skipped', 'Clearance ≥ 0.6 m with avatar radius 0.25 m was not checked.'), severity: 'info' },
    ],
    review: { items: [] },
  };
  return { status: 'ok', url: '/validation/rev-000.json', report: { ...base, ...overrides } };
}

describe('walkVerification', () => {
  it('does not promote walkReady with skipped clearance to a ready walk', () => {
    const status = walkVerification(report({}));
    expect(status.level).toBe('trial');
    expect(status.headline).toBe('Room connectivity is verified. Clearance is not verified.');
    expect(status.headline).not.toMatch(/ready/i);
    expect(status.lines).toContain('Room connectivity: verified.');
    expect(status.lines).toContain('Entrance start: verified.');
    expect(status.lines).toContain('Clearance: not verified (skipped).');
  });

  it('calls the walk ready only when clearance itself passed', () => {
    const status = walkVerification(report({
      checks: [
        check('navigation.reachable', 'pass', 'ok'),
        check('navigation.start', 'pass', 'ok'),
        check('navigation.clearance', 'pass', 'Passages are wider than 0.6 m.'),
      ],
    }));
    expect(status.level).toBe('ready');
    expect(status.headline).toBe('Room connectivity and clearance are verified. The walkthrough is ready.');
  });

  it('keeps a trial walk with reasons when the report says the geometry is not ready', () => {
    const status = walkVerification(report({
      walkReady: false,
      checks: [
        check('navigation.reachable', 'fail', 'Room unreachable from the entrance: Corridor.'),
        check('navigation.start', 'pass', 'ok'),
        check('navigation.clearance', 'skipped', 'not checked'),
      ],
    }));
    expect(status.level).toBe('not-ready');
    expect(status.headline).toBe('Geometry is not confirmed: room connectivity failed. Clearance is not verified.');
    expect(status.lines).toContain('Room connectivity: failed. Room unreachable from the entrance: Corridor.');
  });

  it('treats unverified navigation as unchecked, never as passed', () => {
    const status = walkVerification(report({
      walkReady: false,
      checks: [check('navigation.reachable', 'unverified', 'Navigation was not computed.'), check('navigation.start', 'unverified', 'none')],
    }));
    expect(status.level).toBe('not-ready');
    expect(status.headline).toBe('Geometry is not confirmed: room connectivity is not verified. Clearance is not verified.');
  });

  it('explains a report for another model or revision and a missing report as unverified', () => {
    const stale = walkVerification({ ...report({ revision: 3 }), status: 'stale' } as ReportResult);
    expect(stale.level).toBe('none');
    expect(stale.headline).toBe('The validation report belongs to a different model or revision. Room connectivity and clearance have not been verified.');
    const missing = walkVerification({ status: 'missing', url: '/validation/rev-000.json' });
    expect(missing.level).toBe('none');
    expect(missing.headline).toBe('No Validator report. Room connectivity and clearance have not been verified.');
    const invalid = walkVerification({ status: 'invalid', url: '/x', issues: ['walkReady: Invalid'] });
    expect(invalid.headline).toMatch(/does not match the contract/);
  });
});

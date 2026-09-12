import type { ValidationReport } from '@flatwalk/contract';
import type { ReportResult } from './load-report';

/**
 * Walk readiness in words, derived from the navigation checks of the Validator report.
 * `walkReady` alone is graph connectivity plus a valid start; physical clearance is a separate check
 * (`navigation.clearance`) that the current Validator marks as skipped, so it is never promoted to «готова».
 */

export type VerificationLevel = 'ready' | 'trial' | 'not-ready' | 'none';

export type WalkVerification = {
  level: VerificationLevel;
  headline: string;
  lines: string[];
};

type Check = ValidationReport['checks'][number];
type Outcome = { status: 'pass' | 'fail' | 'skipped' | 'unverified' | 'missing'; messages: string[] };

function outcome(checks: Check[], id: string): Outcome {
  const matching = checks.filter((check) => check.checkId === id || check.checkId.startsWith(`${id}.`));
  if (!matching.length) return { status: 'missing', messages: [] };
  const failed = matching.filter((check) => check.status === 'fail');
  if (failed.length) return { status: 'fail', messages: failed.map((check) => check.message).filter(Boolean) };
  if (matching.every((check) => check.status === 'pass')) return { status: 'pass', messages: [] };
  if (matching.some((check) => check.status === 'skipped')) return { status: 'skipped', messages: [] };
  return { status: 'unverified', messages: [] };
}

const UNCHECKED = 'Room connectivity and clearance have not been verified.';

function line(subject: string, done: string, failed: string, result: Outcome): string {
  switch (result.status) {
    case 'pass': return `${subject}: ${done}.`;
    case 'fail': return `${subject}: ${failed}.${result.messages.length ? ` ${result.messages.join(' ')}` : ''}`;
    case 'skipped': return `${subject}: not verified (skipped).`;
    default: return `${subject}: not verified.`;
  }
}

export function walkVerification(report: ReportResult): WalkVerification {
  if (report.status === 'missing') return { level: 'none', headline: `No Validator report. ${UNCHECKED}`, lines: [] };
  if (report.status === 'stale') {
    return { level: 'none', headline: `The validation report belongs to a different model or revision. ${UNCHECKED}`, lines: [] };
  }
  if (report.status === 'invalid') {
    return { level: 'none', headline: `The validation report does not match the contract and is ignored. ${UNCHECKED}`, lines: [] };
  }

  const { checks, walkReady } = report.report;
  const reachable = outcome(checks, 'navigation.reachable');
  const start = outcome(checks, 'navigation.start');
  const clearance = outcome(checks, 'navigation.clearance');

  const lines = [
    line('Room connectivity', 'verified', 'failed', reachable),
    line('Entrance start', 'verified', 'failed', start),
    clearance.status === 'pass' ? 'Clearance: verified.'
      : clearance.status === 'fail' ? `Clearance: insufficient.${clearance.messages.length ? ` ${clearance.messages.join(' ')}` : ''}`
        : clearance.status === 'skipped' ? 'Clearance: not verified (skipped).'
          : 'Clearance: not verified.',
  ];

  const clearanceWord = clearance.status === 'pass' ? 'verified' : clearance.status === 'fail' ? 'insufficient' : 'not verified';
  const graphOk = reachable.status === 'pass' && start.status === 'pass' && walkReady;

  if (graphOk && clearance.status === 'pass') {
    return { level: 'ready', headline: 'Room connectivity and clearance are verified. The walkthrough is ready.', lines };
  }
  if (graphOk && clearance.status !== 'fail') {
    return { level: 'trial', headline: `Room connectivity is verified. Clearance is ${clearanceWord}.`, lines };
  }

  const reason = reachable.status === 'fail' ? 'room connectivity failed'
    : reachable.status !== 'pass' ? 'room connectivity is not verified'
      : start.status === 'fail' ? 'the entrance start failed'
        : start.status !== 'pass' ? 'the entrance start is not verified'
          : clearance.status === 'fail' ? 'clearance is insufficient'
            : 'geometry checks failed';
  return { level: 'not-ready', headline: `Geometry is not confirmed: ${reason}. Clearance is ${clearanceWord}.`, lines };
}

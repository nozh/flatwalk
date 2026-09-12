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

const UNCHECKED = 'Связность комнат и ширина проходов не проверены.';

function line(subject: string, done: string, failed: string, result: Outcome): string {
  switch (result.status) {
    case 'pass': return `${subject}: ${done}.`;
    case 'fail': return `${subject}: ${failed}.${result.messages.length ? ` ${result.messages.join(' ')}` : ''}`;
    case 'skipped': return `${subject}: не проверен${subject.endsWith('а') || subject.endsWith('ов') ? 'а' : ''} (пропущено).`;
    default: return `${subject}: не проверен${subject.endsWith('а') || subject.endsWith('ов') ? 'а' : ''}.`;
  }
}

export function walkVerification(report: ReportResult): WalkVerification {
  if (report.status === 'missing') return { level: 'none', headline: `Отчёта Validator нет. ${UNCHECKED}`, lines: [] };
  if (report.status === 'stale') {
    return { level: 'none', headline: `Отчёт проверки относится к другой модели или ревизии. ${UNCHECKED}`, lines: [] };
  }
  if (report.status === 'invalid') {
    return { level: 'none', headline: `Отчёт проверки не соответствует контракту и не учитывается. ${UNCHECKED}`, lines: [] };
  }

  const { checks, walkReady } = report.report;
  const reachable = outcome(checks, 'navigation.reachable');
  const start = outcome(checks, 'navigation.start');
  const clearance = outcome(checks, 'navigation.clearance');

  const lines = [
    line('Связность комнат', 'проверена', 'не пройдена', reachable),
    line('Старт от входа', 'проверен', 'не пройден', start),
    clearance.status === 'pass' ? 'Ширина проходов: проверена.'
      : clearance.status === 'fail' ? `Ширина проходов: недостаточна.${clearance.messages.length ? ` ${clearance.messages.join(' ')}` : ''}`
        : clearance.status === 'skipped' ? 'Ширина проходов: не проверена (пропущено).'
          : 'Ширина проходов: не проверена.',
  ];

  const clearanceWord = clearance.status === 'pass' ? 'проверена' : clearance.status === 'fail' ? 'недостаточна' : 'не проверена';
  const graphOk = reachable.status === 'pass' && start.status === 'pass' && walkReady;

  if (graphOk && clearance.status === 'pass') {
    return { level: 'ready', headline: 'Связность комнат и ширина проходов проверены. Прогулка готова.', lines };
  }
  if (graphOk && clearance.status !== 'fail') {
    return { level: 'trial', headline: `Связность комнат проверена. Ширина проходов ${clearanceWord}.`, lines };
  }

  const reason = reachable.status === 'fail' ? 'связность комнат не пройдена'
    : reachable.status !== 'pass' ? 'связность комнат не проверена'
      : start.status === 'fail' ? 'старт от входа не пройден'
        : start.status !== 'pass' ? 'старт от входа не проверен'
          : clearance.status === 'fail' ? 'ширина проходов недостаточна'
            : 'проверки геометрии не пройдены';
  return { level: 'not-ready', headline: `Геометрия не подтверждена: ${reason}. Ширина проходов ${clearanceWord}.`, lines };
}

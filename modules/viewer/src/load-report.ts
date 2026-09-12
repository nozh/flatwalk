import { ValidationReportSchema, type ValidationReport } from '@flatwalk/contract';
import { assetBase, type DataSource } from './source';
import { defaultFetchJson, formatIssues, type FetchJson } from './load-model';

export type ReportResult =
  | { status: 'ok'; report: ValidationReport; url: string }
  | { status: 'stale'; report: ValidationReport; url: string }
  | { status: 'missing'; url: string }
  | { status: 'invalid'; url: string; issues: string[] };

export function reportUrl(source: DataSource, revision: number): string {
  return `${assetBase(source)}validation/rev-${String(revision).padStart(3, '0')}.json`;
}

/** The report is optional: without it the geometry simply counts as unverified. */
export async function loadValidationReport(
  source: DataSource,
  model: { id: string; revision: number },
  deps: { fetchJson?: FetchJson } = {},
): Promise<ReportResult> {
  const url = reportUrl(source, model.revision);
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  let response;
  try {
    response = await fetchJson(url);
  } catch {
    return { status: 'missing', url };
  }
  if (!response.ok || response.status === 404 || response.body === null) return { status: 'missing', url };
  const parsed = ValidationReportSchema.safeParse(response.body);
  if (!parsed.success) return { status: 'invalid', url, issues: formatIssues(parsed.error) };
  const report = parsed.data;
  if (report.modelId !== model.id || report.revision !== model.revision) return { status: 'stale', report, url };
  return { status: 'ok', report, url };
}

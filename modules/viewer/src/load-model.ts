import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { modelUrl, type DataSource } from './source';

export type FetchJson = (url: string) => Promise<{ ok: boolean; status: number; body: unknown }>;

export type LoadResult =
  | { status: 'ok'; model: FlatModel; source: DataSource }
  | { status: 'missing'; source: DataSource; url: string }
  | { status: 'invalid'; source: DataSource; url: string; issues: string[] };

export async function defaultFetchJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) return { ok: false, status: response.status, body: null };
  try {
    return { ok: true, status: response.status, body: await response.json() };
  } catch {
    return { ok: true, status: response.status, body: null };
  }
}

export function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

export async function loadFlatModel(
  source: DataSource,
  deps: { fetchJson?: FetchJson } = {},
): Promise<LoadResult> {
  const url = modelUrl(source);
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const response = await fetchJson(url);
  if (!response.ok || response.status === 404) {
    return { status: 'missing', source, url };
  }
  const parsed = validateFlatModel(response.body);
  if (!parsed.success) {
    return { status: 'invalid', source, url, issues: formatIssues(parsed.error) };
  }
  return { status: 'ok', model: parsed.data, source };
}

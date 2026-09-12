export type DataSource =
  | { kind: 'static' }
  | { kind: 'fixture' }
  | { kind: 'job'; origin: string; jobId: string };

export function dataSourceFromSearch(search: string, jobOrigin?: string): DataSource {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('src') === 'fixture') return { kind: 'fixture' };
  const jobId = params.get('job')?.trim();
  if (jobId && jobOrigin) return { kind: 'job', origin: jobOrigin.replace(/\/+$/, ''), jobId };
  return { kind: 'static' };
}

export function modelUrl(source: DataSource): string {
  if (source.kind === 'fixture') return '/fixtures/54541/flat.model.json';
  if (source.kind === 'job') return jobFileUrl(source.origin, source.jobId, 'model/latest.json');
  return '/model/latest.json';
}

export function assetBase(source: DataSource): string {
  if (source.kind === 'fixture') return '/fixtures/54541/';
  if (source.kind === 'job') return `${source.origin}/api/jobs/${source.jobId}/file/`;
  return '/';
}

export function jobFileUrl(origin: string, jobId: string, rel: string): string {
  const cleaned = rel.replace(/^\.\//, '').replace(/^\/+/, '');
  return `${origin.replace(/\/+$/, '')}/api/jobs/${jobId}/file/${cleaned}`;
}

export function resolveAssetUrl(source: DataSource, url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('storage://')) return url;
  if (source.kind === 'job') {
    if (url.startsWith('/api/jobs/')) return `${source.origin}${url}`;
    if (url.startsWith('/')) return jobFileUrl(source.origin, source.jobId, url.slice(1));
    return jobFileUrl(source.origin, source.jobId, url);
  }
  if (url.startsWith('/')) return url;
  const base = assetBase(source);
  const cleaned = url.replace(/^\.\//, '');
  return `${base}${cleaned}`.replace(/\/{2,}/g, '/');
}

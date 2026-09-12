export type DataSource = { kind: 'static' } | { kind: 'fixture' };

export function dataSourceFromSearch(search: string): DataSource {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('src') === 'fixture' ? { kind: 'fixture' } : { kind: 'static' };
}

export function modelUrl(source: DataSource): string {
  return source.kind === 'fixture' ? '/fixtures/54541/flat.model.json' : '/model/latest.json';
}

export function assetBase(source: DataSource): string {
  return source.kind === 'fixture' ? '/fixtures/54541/' : '/';
}

export function resolveAssetUrl(source: DataSource, url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url) || url.startsWith('/')) return url;
  if (url.startsWith('storage://')) return url;
  const base = assetBase(source);
  const cleaned = url.replace(/^\.\//, '');
  return `${base}${cleaned}`.replace(/\/{2,}/g, '/');
}

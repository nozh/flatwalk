import type { FlatModel } from '@flatwalk/contract';
import { dataSourceFromSearch, type DataSource } from './source';

export type ViewerQuery = {
  source: DataSource;
  demo: boolean;
  rewriteSearch?: string;
};

export function publicDemoEnabled(): boolean {
  return import.meta.env.VITE_PUBLIC_DEMO === 'true';
}

/** Public static demo always opens the prepared 54541 fixture. */
export function parseViewerQuery(search: string, publicDemo = false): ViewerQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const demoParam = params.get('demo') === '1';
  if (!publicDemo) return { source: dataSourceFromSearch(search), demo: demoParam };

  const needsRewrite = params.get('src') !== 'fixture' || params.get('demo') !== '1';
  if (needsRewrite) {
    params.set('src', 'fixture');
    params.set('demo', '1');
  }
  return {
    source: { kind: 'fixture' },
    demo: true,
    ...(needsRewrite ? { rewriteSearch: `?${params.toString()}` } : {}),
  };
}

/** Local Viewer fixtures must not be presented as listing apartment 54541. */
export function isSyntheticModel(model: Pick<FlatModel, 'id' | 'source'>): boolean {
  if (model.id.startsWith('viewer-')) return true;
  return model.source.site === 'manual' && !model.source.listingId && !model.source.url;
}

export const DEMO_DISCLOSURE = 'Demo · prepared model 54541 · URL processing is simulated';
export const SYNTHETIC_DISCLOSURE = 'Test apartment · not a listing. This model is local Viewer test data.';

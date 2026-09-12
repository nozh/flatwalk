import type { FlatModel } from '@flatwalk/contract';
import { dataSourceFromSearch, type DataSource } from './source';
import { parseRunIsSynthetic, type JobSnapshot } from './job-api';

export type ViewerQuery = {
  source: DataSource;
  demo: boolean;
  jobId?: string;
  rewriteSearch?: string;
};

export function publicDemoEnabled(): boolean {
  return import.meta.env.VITE_PUBLIC_DEMO === 'true';
}

/**
 * Public static demo always opens the prepared 54541 fixture.
 * `demo=1` keeps the provenance banner after refresh and on direct links.
 * Job IDs are ignored on the public site so it never targets a local job API.
 */
export function parseViewerQuery(search: string, publicDemo = false, jobOrigin?: string): ViewerQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const demoParam = params.get('demo') === '1';
  const jobId = params.get('job')?.trim() || undefined;
  if (publicDemo) {
    const needsRewrite = params.get('src') !== 'fixture' || params.get('demo') !== '1';
    if (needsRewrite) {
      params.set('src', 'fixture');
      params.set('demo', '1');
      params.delete('job');
    }
    return {
      source: { kind: 'fixture' },
      demo: true,
      ...(needsRewrite ? { rewriteSearch: `?${params.toString()}` } : {}),
    };
  }
  return {
    source: dataSourceFromSearch(search, jobOrigin),
    demo: demoParam,
    ...(jobId ? { jobId } : {}),
  };
}

/** Local `demo-run` / viewer-test models must not be presented as a listing apartment. */
export function isSyntheticModel(model: Pick<FlatModel, 'id' | 'source'>): boolean {
  if (model.id.startsWith('viewer-')) return true;
  return model.source.site === 'manual' && !model.source.listingId && !model.source.url;
}

/** Fixture grok-rects geometry that still carries listing photos/IDs. Live grok-rects is not this. */
export function isSyntheticFixtureGeometry(_model: Pick<FlatModel, 'id'>, snapshot?: JobSnapshot): boolean {
  return snapshot ? parseRunIsSynthetic(snapshot) : false;
}

export const DEMO_DISCLOSURE = 'Demo · prepared model 54541 · URL processing is simulated';
export const SYNTHETIC_DISCLOSURE = 'Test apartment · not a listing. This model is local Viewer test data.';
export const SYNTHETIC_FIXTURE_DISCLOSURE =
  'Synthetic fixture geometry · grok-rects placeholder, not recognition of listing 54541. Listing photos are source materials only and were not used to build these walls.';
export const MANUAL_PREPARED_DEMO_DISCLOSURE = DEMO_DISCLOSURE;

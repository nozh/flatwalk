import './style.css';
import { mountDemoEntry } from './demo-entry';
import { isSyntheticFixtureGeometry, parseViewerQuery, publicDemoEnabled } from './demo-flags';
import { mountJobEntry, replaceJobUrl } from './job-entry';
import { jobApiBase, type JobSnapshot } from './job-api';
import { loadFlatModel } from './load-model';
import { loadValidationReport, reportFromSnapshot } from './load-report';
import { renderShell, type ViewerState } from './shell';
import { mountScenePlaceholder } from './scene-placeholder';
import { listingView } from './view-model';
import { mountListing, type ListingController } from './interactions';
import { prepareWalk, type WalkPrep } from './walk-prep';
import { mountWalkScene } from './walk-scene';
import { validateFlatModel, type FlatModel } from '@flatwalk/contract';
import { formatIssues } from './load-model';
import { modelUrl, type DataSource } from './source';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app is missing');
const root = app;

let controller: ListingController | undefined;
let disposeJob: (() => void) | undefined;

function paint(state: ViewerState): void {
  controller?.dispose();
  controller = undefined;
  root.innerHTML = renderShell(state);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action="reload"]')) {
    button.addEventListener('click', () => window.location.reload());
  }
  if (state.kind !== 'ready') return;
  const { model, prep, report } = state;
  controller = mountListing(root, listingView(model, state.source), {
    mountScene: mountScenePlaceholder,
    ...(report ? { report } : {}),
    ...(prep ? { prep, mountWalk: (host, hooks) => mountWalkScene(host, model, prep, hooks) } : {}),
  });
}

function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

function safePrepareWalk(model: Parameters<typeof prepareWalk>[0]): WalkPrep {
  try {
    return prepareWalk(model);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      scene: null,
      sceneError: reason,
      walk: { available: false, reason, segments: [], polygons: {}, areas: null },
      diagnostics: [`Builder or Geometry Core failed: ${reason}.`],
    };
  }
}

async function showReady(
  model: FlatModel,
  source: DataSource,
  extras: { demo?: boolean; syntheticFixture?: boolean } = {},
  reportOverride?: ReturnType<typeof reportFromSnapshot>,
): Promise<void> {
  const view = listingView(model, source);
  const [planOk, report] = await Promise.all([
    view.planUrl ? probeImage(view.planUrl) : Promise.resolve(false),
    reportOverride ? Promise.resolve(reportOverride) : loadValidationReport(source, model),
  ]);
  paint({
    kind: 'ready',
    model,
    source,
    plan: { status: planOk ? 'ok' : 'unavailable' },
    report,
    prep: safePrepareWalk(model),
    demo: extras.demo,
    syntheticFixture: extras.syntheticFixture,
  });
}

async function bootViewer(): Promise<void> {
  const origin = jobApiBase();
  const query = parseViewerQuery(window.location.search, publicDemoEnabled(), origin);
  if (query.rewriteSearch) {
    const url = new URL(window.location.href);
    window.history.replaceState(null, '', `${url.pathname}${query.rewriteSearch}${url.hash}`);
  }
  const { source, demo } = query;
  paint({ kind: 'loading', demo });
  let result;
  try {
    result = await loadFlatModel(source);
  } catch {
    paint({ kind: 'missing', source, demo, url: modelUrl(source) });
    return;
  }
  if (result.status === 'missing') {
    paint({ kind: 'missing', source: result.source, demo, url: result.url });
    return;
  }
  if (result.status === 'invalid') {
    paint({ kind: 'invalid', issues: result.issues, demo });
    return;
  }
  await showReady(result.model, result.source, { demo });
}

async function openJobResult(snapshot: JobSnapshot): Promise<void> {
  const origin = jobApiBase();
  if (!origin) {
    paint({ kind: 'missing', source: { kind: 'static' }, url: '/model/latest.json' });
    return;
  }
  replaceJobUrl(snapshot.job.id);
  const source: DataSource = { kind: 'job', origin, jobId: snapshot.job.id };
  if (!snapshot.model) {
    paint({ kind: 'missing', source, url: modelUrl(source) });
    return;
  }
  const parsed = validateFlatModel(snapshot.model);
  if (!parsed.success) {
    paint({ kind: 'invalid', issues: formatIssues(parsed.error) });
    return;
  }
  const syntheticFixture = isSyntheticFixtureGeometry(parsed.data, snapshot);
  const report = reportFromSnapshot(snapshot, parsed.data);
  await showReady(parsed.data, source, { syntheticFixture }, report);
  root.querySelector<HTMLButtonElement>('[data-view="scene"]')?.click();
}

async function openPreparedDemo(): Promise<void> {
  const url = new URL(window.location.href);
  url.searchParams.delete('job');
  url.searchParams.set('src', 'fixture');
  url.searchParams.set('demo', '1');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  await bootViewer();
  root.querySelector<HTMLButtonElement>('[data-view="scene"]')?.click();
}

function start(): void {
  disposeJob?.();
  disposeJob = undefined;
  const params = new URLSearchParams(window.location.search);
  const origin = jobApiBase();
  const publicDemo = publicDemoEnabled();

  if (publicDemo && !params.has('src') && !params.has('job')) {
    mountDemoEntry(root, openPreparedDemo);
    return;
  }

  const watchingJob = Boolean(origin) && !publicDemo && params.get('src') !== 'fixture' && Boolean(params.get('job'));
  const showJobForm = Boolean(origin) && !publicDemo && !params.get('src') && !params.get('job');
  if (origin && (watchingJob || showJobForm)) {
    disposeJob = mountJobEntry(root, {
      origin,
      ...(params.get('job') ? { jobId: params.get('job') ?? undefined } : {}),
      openPreparedDemo,
      openJobResult,
    });
    return;
  }

  void bootViewer();
}

Object.defineProperty(window, '__flatwalk', { value: { inspect: () => controller?.inspect() ?? null }, writable: false });

start();

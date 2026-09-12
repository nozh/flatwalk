import './style.css';
import { mountDemoEntry } from './demo-entry';
import { dataSourceFromSearch } from './source';
import { loadFlatModel } from './load-model';
import { loadValidationReport } from './load-report';
import { renderShell, type ViewerState } from './shell';
import { mountScenePlaceholder } from './scene-placeholder';
import { listingView } from './view-model';
import { mountListing, type ListingController } from './interactions';
import { prepareWalk, type WalkPrep } from './walk-prep';
import { mountWalkScene } from './walk-scene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app is missing');
const root = app;

let controller: ListingController | undefined;

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

/** The plan picture is checked before the first paint so the stage never flashes a broken image. */
function probeImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/** Builder and Geometry Core run once per model; any failure becomes a diagnostic line, never a blank screen. */
function safePrepareWalk(model: Parameters<typeof prepareWalk>[0]): WalkPrep {
  try {
    return prepareWalk(model);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      scene: null,
      sceneError: reason,
      walk: { available: false, reason, segments: [], polygons: {}, areas: null },
      diagnostics: [`Builder или Geometry Core завершились ошибкой: ${reason}.`],
    };
  }
}

async function boot(): Promise<void> {
  const source = dataSourceFromSearch(window.location.search);
  paint({ kind: 'loading' });
  let result;
  try {
    result = await loadFlatModel(source);
  } catch {
    paint({ kind: 'missing', source, url: source.kind === 'fixture' ? '/fixtures/54541/flat.model.json' : '/model/latest.json' });
    return;
  }
  if (result.status === 'missing') {
    paint({ kind: 'missing', source: result.source, url: result.url });
    return;
  }
  if (result.status === 'invalid') {
    paint({ kind: 'invalid', issues: result.issues });
    return;
  }
  const view = listingView(result.model, result.source);
  const [planOk, report] = await Promise.all([
    view.planUrl ? probeImage(view.planUrl) : Promise.resolve(false),
    loadValidationReport(result.source, result.model),
  ]);
  paint({
    kind: 'ready',
    model: result.model,
    source: result.source,
    plan: { status: planOk ? 'ok' : 'unavailable' },
    report,
    prep: safePrepareWalk(result.model),
  });
}

// Read-only diagnostics for browser smoke checks (prototype pattern); no state-mutating backdoor.
Object.defineProperty(window, '__flatwalk', { value: { inspect: () => controller?.inspect() ?? null }, writable: false });

async function openPublicDemo(): Promise<void> {
  await boot();
  root.querySelector<HTMLButtonElement>('[data-view="scene"]')?.click();
}

if (import.meta.env.VITE_PUBLIC_DEMO === 'true' && !new URLSearchParams(window.location.search).has('src')) {
  mountDemoEntry(root, openPublicDemo);
} else {
  void boot();
}

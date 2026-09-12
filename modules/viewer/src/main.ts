import './style.css';
import { dataSourceFromSearch } from './source';
import { loadFlatModel } from './load-model';
import { loadValidationReport } from './load-report';
import { renderShell, type ViewerState } from './shell';
import { mountScenePlaceholder } from './scene-placeholder';
import { listingView } from './view-model';
import { mountListing, type ListingController } from './interactions';

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
  controller = mountListing(root, listingView(state.model, state.source), { mountScene: mountScenePlaceholder });
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
  });
}

void boot();

import { buildMassing, renderMassingSvg } from './hero-massing';
import { loadFlatModel } from './load-model';
import planThumb from './media/source-plan.webp';
import photoLiving from './media/source-photo-01.webp';
import photoDining from './media/source-photo-04.webp';
import photoKitchen from './media/source-photo-06.webp';

/**
 * Shared first screen for both entry paths: the public demo form and the local job form.
 * Only the body differs; the headline and the figure stay the same so the two modes are one product.
 */

const TITLE = 'See how the apartment fits together.';
const LEDE =
  'FlatWalk turns a listing’s floor plan and photos into an approximate 3D layout. '
  + 'Look down on the whole flat, then walk from room to room in your browser.';

const SOURCE_THUMBS: { src: string; alt: string }[] = [
  { src: planThumb, alt: 'Floor plan published with listing 54541' },
  { src: photoLiving, alt: 'Listing photo of the living room' },
  { src: photoDining, alt: 'Listing photo of the dining area' },
  { src: photoKitchen, alt: 'Listing photo of the kitchen' },
];

export function renderEntry(body: string): string {
  return `<main class="entry">
    <div class="entry-grid">
      <div class="entry-lede">
        <p class="brand">FlatWalk</p>
        <h1 class="entry-title">${TITLE}</h1>
        <p class="entry-sub">${LEDE}</p>
      </div>
      ${renderFigure()}
      <div class="entry-body">${body}</div>
    </div>
  </main>`;
}

function renderFigure(): string {
  const thumbs = SOURCE_THUMBS.map(({ src, alt }, index) =>
    `<img class="figure-thumb${index === 0 ? ' is-plan' : ''}" src="${src}" alt="${alt}" width="120" height="90" decoding="async" />`,
  ).join('');
  return `<figure class="entry-figure">
    <div class="figure-thumbs">${thumbs}</div>
    <div class="figure-flow" aria-hidden="true"><span class="figure-flow-line"></span><span class="figure-flow-tip"></span></div>
    <div class="figure-model" data-hero-figure>${renderFallback()}</div>
    <figcaption class="figure-caption">
      Built from the floor plan and 17 photos published with listing 54541. Walls, doorways and
      windows are read from the plan and raised to a storey height, so sizes are approximate —
      a layout to explore, not a surveyed measurement.
    </figcaption>
  </figure>`;
}

function renderFallback(): string {
  return '<div class="figure-pending" role="presentation"></div>';
}

let cachedSvg: string | null | undefined;
let pending: Promise<string | null> | undefined;
let played = false;

async function fetchMassingSvg(): Promise<string | null> {
  const result = await loadFlatModel({ kind: 'fixture' });
  if (result.status !== 'ok') return null;
  const massing = buildMassing(result.model);
  if (!massing) return null;
  return renderMassingSvg(massing);
}

/**
 * Draws the reference apartment from its real FlatModel. The file is small and is the same one the
 * prepared demo opens, so the figure costs one warm request and never invents geometry of its own.
 * Re-paints (job progress, retry) reuse the cached drawing instead of refetching.
 */
export function mountHeroFigure(root: HTMLElement): void {
  const host = root.querySelector<HTMLElement>('[data-hero-figure]');
  if (!host) return;

  const place = (svg: string | null) => {
    const current = root.querySelector<HTMLElement>('[data-hero-figure]');
    if (!current) return;
    if (!svg) {
      current.closest('.entry-figure')?.setAttribute('data-model', 'unavailable');
      current.innerHTML = '';
      return;
    }
    current.innerHTML = svg;
    if (played) return;
    played = true;
    current.querySelector('.hero-massing')?.classList.add('is-entering');
  };

  if (cachedSvg !== undefined) {
    place(cachedSvg);
    return;
  }
  pending ??= fetchMassingSvg().catch(() => null);
  void pending.then((svg) => {
    cachedSvg = svg;
    place(svg);
  });
}

/** Test seam: the figure caches one drawing per page load. */
export function resetHeroFigureCache(): void {
  cachedSvg = undefined;
  pending = undefined;
  played = false;
}

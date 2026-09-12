import { mountHeroFigure, renderEntry } from './entry-shell';

/** Static showcase: a simulated job opens the explicitly labelled reference apartment. */

const DEFAULT_LISTING =
  'https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/troiposoban-stan-svetogorska-stari-grad';

const SIMULATED_STEPS = [
  'Reading the listing materials',
  'Fitting walls, doorways and windows to the plan',
  'Raising the rooms and opening the walkthrough',
];

function renderForm(): string {
  return `<form class="entry-form">
      <label class="field-label" for="listing-url">Listing URL</label>
      <input id="listing-url" class="field-input" type="url" required
        placeholder="https://cityexpert.rs/…" value="${DEFAULT_LISTING}"
        aria-describedby="entry-disclosure" spellcheck="false" autocomplete="url" />
      <p class="demo-note" id="entry-disclosure">This demo does not process the address you enter.
        Any URL opens the same prepared apartment, listing 54541; your URL is not analyzed and no listing site is contacted.</p>
      <div class="entry-actions">
        <button type="submit" class="cta">Build the walkthrough</button>
        <button type="button" class="cta is-quiet demo-skip">Explore the demo</button>
      </div>
    </form>
    <ol aria-live="polite" aria-label="Simulated build steps" class="demo-steps"></ol>`;
}

export function mountDemoEntry(root: HTMLElement, open: () => Promise<void>): void {
  root.innerHTML = renderEntry(renderForm());
  mountHeroFigure(root);

  const form = root.querySelector('form')!;
  const input = root.querySelector<HTMLInputElement>('#listing-url')!;
  const steps = root.querySelector<HTMLOListElement>('.demo-steps')!;
  let busy = false;

  async function show(): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('src', 'fixture');
    url.searchParams.set('demo', '1');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    await open();
  }

  root.querySelector('.demo-skip')!.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void show();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    if (!/^https?:$/.test(new URL(input.value).protocol)) {
      input.setCustomValidity('Enter an http or https URL.');
      input.reportValidity();
      return;
    }
    busy = true;
    root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    void (async () => {
      for (const label of SIMULATED_STEPS) {
        const item = document.createElement('li');
        item.textContent = label;
        steps.append(item);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }
      await show();
    })();
  });

  input.addEventListener('input', () => input.setCustomValidity(''));
}

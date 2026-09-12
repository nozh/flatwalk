/** Static showcase: a simulated job opens the explicitly labelled reference apartment. */
export function mountDemoEntry(root: HTMLElement, open: () => Promise<void>): void {
  root.innerHTML = `<main class="demo-entry"><div class="demo-card"><span class="demo-badge">FLATWALK · DEMO</span><h1>From a listing —<br>into the apartment</h1><p>Explore the floor plan and photos, then walk through the apartment in 3D.</p><form><label for="listing-url">Listing URL</label><input id="listing-url" type="url" required placeholder="https://cityexpert.rs/…" value="https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/troiposoban-stan-svetogorska-stari-grad"><button type="submit">See how it works →</button></form><p class="demo-note">Processing is simulated in this demo. Any URL opens the same prepared model 54541; the entered URL is not analyzed.</p><ol aria-live="polite" class="demo-steps"></ol><button class="demo-skip" type="button">Open prepared demo</button></div></main>`;
  const form = root.querySelector('form')!;
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
    const value = (root.querySelector('input') as HTMLInputElement).value;
    const input = root.querySelector('input') as HTMLInputElement;
    if (!/^https?:$/.test(new URL(value).protocol)) {
      input.setCustomValidity('Enter an http or https URL.'); input.reportValidity(); return;
    }
    busy = true;
    root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const labels = ['Demo: listing materials', 'Demo: prepared floor plan and model', 'Demo: opening the 3D scene'];
    void (async () => {
      for (const label of labels) {
        const item = document.createElement('li'); item.textContent = label; steps.append(item);
        await new Promise((resolve) => window.setTimeout(resolve, 650));
      }
      await show();
    })();
  });
  root.querySelector('input')!.addEventListener('input', (event) => (event.target as HTMLInputElement).setCustomValidity(''));
}

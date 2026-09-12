/** Static showcase: a simulated job opens the explicitly labelled reference apartment. */
export function mountDemoEntry(root: HTMLElement, open: () => Promise<void>): void {
  root.innerHTML = `<main class="demo-entry"><div class="demo-card"><span class="demo-badge">FLATWALK · ДЕМО</span><h1>Из объявления —<br>внутрь квартиры</h1><p>Посмотрите план, фотографии и пройдите по квартире в 3D.</p><form><label for="listing-url">Ссылка на объявление</label><input id="listing-url" type="url" required placeholder="https://cityexpert.rs/…" value="https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/troiposoban-stan-svetogorska-stari-grad"><button type="submit">Показать, как это работает →</button></form><p class="demo-note">Обработка здесь имитируется. Для любой ссылки откроется одна подготовленная модель 54541 — она не распознаётся из введённого URL.</p><ol aria-live="polite" class="demo-steps"></ol><button class="demo-skip" type="button">Сразу открыть 3D-квартиру</button></div></main>`;
  const form = root.querySelector('form')!;
  const steps = root.querySelector<HTMLOListElement>('.demo-steps')!;
  let busy = false;
  async function show(): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('src', 'fixture');
    url.searchParams.set('demo', '1');
    window.history.replaceState(null, '', url);
    const badge = document.createElement('div');
    badge.className = 'demo-disclosure';
    badge.textContent = 'Демо · подготовленная модель 54541 · обработка URL имитируется';
    document.body.prepend(badge);
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
      input.setCustomValidity('Укажите ссылку http или https.'); input.reportValidity(); return;
    }
    busy = true;
    root.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    const labels = ['Демо: материалы объявления', 'Демо: подготовленный план и модель', 'Демо: открываем 3D-сцену'];
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

import type { FlatModel } from '@flatwalk/contract';
import { listingView } from './view-model';
import type { DataSource } from './source';
import type { ReportResult } from './load-report';
import { buildOverlay, renderOverlaySvg } from './plan-overlay';
import { renderAbout, renderAssumptionStrip, renderLightbox, renderRoomList, renderRoomPanel, renderStageStatus, renderWalkHud, walkTitle } from './panels';
import { walkVerification } from './report-status';
import type { WalkPrep } from './walk-prep';
import { escapeHtml, icon } from './html';

export type ViewerState =
  | { kind: 'loading' }
  | { kind: 'missing'; source: DataSource; url: string }
  | { kind: 'invalid'; issues: string[] }
  | { kind: 'ready'; model: FlatModel; source: DataSource; plan: { status: 'ok' | 'unavailable' }; report?: ReportResult; prep?: WalkPrep };

const NO_REPORT: ReportResult = { status: 'missing', url: '' };

function page(kind: string, body: string): string {
  return `<div class="page page-${kind}">
      <p class="brand">FlatWalk</p>
      ${body}
    </div>`;
}

export function renderShell(state: ViewerState): string {
  if (state.kind === 'loading') {
    return page('loading', `<p class="status" role="status"><span class="spinner" aria-hidden="true"></span>Загружаем модель…</p>`);
  }

  if (state.kind === 'missing') {
    if (state.source.kind === 'fixture') {
      return page('missing', `<h1>Эталон 54541 недоступен</h1>
        <p>Файла <code>${escapeHtml(state.url)}</code> нет рядом с Viewer. Эталон готовится отдельной задачей и не заменяется тестовой моделью.</p>
        <p class="actions"><a class="button" href="./">Открыть модель папки запуска</a><button type="button" class="button is-secondary" data-action="reload">Проверить снова</button></p>`);
    }
    return page('missing', `<h1>Модель не найдена</h1>
      <p>Нет файла <code>${escapeHtml(state.url)}</code>. Положите <code>latest.json</code> в папку запуска и откройте Viewer с <code>FLATWALK_RUN</code>, либо посмотрите эталон.</p>
      <p class="actions"><a class="button" href="?src=fixture">Открыть эталон 54541</a><button type="button" class="button is-secondary" data-action="reload">Проверить снова</button></p>`);
  }

  if (state.kind === 'invalid') {
    const items = state.issues.map((issue) => `<li><code>${escapeHtml(issue)}</code></li>`).join('');
    return page('invalid', `<h1>Модель не прошла проверку</h1>
      <p>Контракт FlatModel отклонил файл: ${state.issues.length} ${state.issues.length === 1 ? 'замечание' : 'замечаний'}. Схема не дублируется в Viewer, поэтому исправлять нужно файл модели.</p>
      <details class="issues"><summary>Показать замечания контракта</summary><ul>${items}</ul></details>
      <p class="actions"><button type="button" class="button" data-action="reload">Проверить снова</button><a class="button is-secondary" href="?src=fixture">Открыть эталон 54541</a></p>`);
  }

  const view = listingView(state.model, state.source);
  const report = state.report ?? NO_REPORT;
  const overlay = buildOverlay(state.model, view.plan, state.plan.status === 'ok');
  const stage = overlay.mode === 'empty'
    ? `<div class="stage-empty"><p>Исходный план недоступен, а геометрии в модели пока нет.</p><p class="muted">Здесь появится план с разметкой, как только Parser вернёт стены.</p></div>`
    : renderOverlaySvg(overlay);
  const sourceChip = state.source.kind === 'fixture' ? 'Эталон 54541' : 'Папка запуска';
  const prep = state.prep;
  const hasScene = Boolean(prep?.scene);
  const walkable = Boolean(prep?.walk.available);
  const verification = walkVerification(report);
  const walkLabel = walkTitle(verification);
  const walkHint = !prep
    ? 'после сборки 3D-сцены'
    : !prep.walk.available ? `недоступна: ${prep.walk.reason}`
      : verification.level === 'ready' ? 'WASD и мышь, Esc — выход'
        : verification.level === 'trial' ? 'ширина проходов не проверена; WASD и мышь, Esc — выход'
          : 'геометрия не подтверждена отчётом; WASD и мышь, Esc — выход';
  const sceneEmpty = hasScene
    ? ''
    : `<p class="scene-empty">3D-сцена ещё не построена: ${escapeHtml(prep?.sceneError ?? 'Builder не подключён')}.</p>`;
  const listingLink = view.source.url
    ? `<a class="topbar-link" href="${escapeHtml(view.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(view.source.siteLabel)}${icon('external')}</a>`
    : `<span>${escapeHtml(view.source.siteLabel)}</span>`;

  return `<div class="app" data-view="plan" data-marks="on">
    <header class="topbar">
      <a class="brand" href="./">FlatWalk</a>
      <div class="topbar-title">
        <h1>${escapeHtml(view.title)}</h1>
        <p class="topbar-meta">${listingLink}<span class="topbar-sep" aria-hidden="true"></span><span>ревизия ${view.revision}</span></p>
      </div>
      <div class="topbar-actions">
        <span class="chip" title="Статический режим: правки не сохраняются, Convex не подключён">Статический режим, ${escapeHtml(sourceChip.toLowerCase())}</span>
        <button type="button" class="text-button" data-action="about">${icon('info')}О модели</button>
      </div>
    </header>
    <main class="workspace">
      <section class="stage" aria-label="Квартира сверху">
        <div class="stage-toolbar">
          <div class="segmented" role="group" aria-label="Вид">
            <button type="button" data-view="plan" aria-pressed="true">${icon('plan')}План</button>
            <button type="button" data-view="top" aria-pressed="false"${hasScene ? '' : ' disabled'}>${icon('layers')}Сверху</button>
            <button type="button" data-view="scene" aria-pressed="false">${icon('cube')}Обзор</button>
          </div>
          <button type="button" class="toggle" data-action="toggle-marks" aria-pressed="true"${overlay.mode === 'plan' ? '' : ' hidden'}>${icon('marks')}Разметка модели</button>
          <div class="walk">
            <button type="button" class="walk-button" data-action="walk" data-label="${escapeHtml(walkLabel)}"${walkable ? '' : ' disabled'} aria-describedby="walk-hint">${icon('walk')}<span class="walk-label">${escapeHtml(walkLabel)}</span></button>
            <span id="walk-hint" class="walk-hint">${escapeHtml(walkHint)}</span>
          </div>
          <button type="button" class="icon-button stage-fullscreen" data-action="fullscreen" aria-label="Во весь экран" title="Во весь экран">${icon('expand')}</button>
        </div>
        <div class="stage-canvas">
          <div class="stage-plan" id="stage-plan" data-mode="${overlay.mode}">${stage}</div>
          <div class="stage-scene" id="stage-scene" hidden>
            <div id="scene-slot" class="scene-slot"></div>
            ${sceneEmpty}
            <div id="walk-hud" class="walk-hud" hidden>${renderWalkHud(verification)}</div>
          </div>
        </div>
        <p class="stage-status" id="stage-status" role="status">${escapeHtml(renderStageStatus('plan', overlay.mode))}</p>
        <div id="toast" class="toast" role="status" hidden></div>
      </section>
      <aside class="sidebar">
        <nav class="room-list" id="room-list" aria-label="Помещения">${renderRoomList(view, 'all')}</nav>
        <section class="room-panel" id="room-panel" aria-live="polite">${renderRoomPanel(view, 'all')}</section>
      </aside>
    </main>
    <footer class="assumptions" id="assumption-strip">${renderAssumptionStrip(view, report)}</footer>
    <dialog class="dialog about" id="about-dialog" aria-labelledby="about-title">${renderAbout(view, report, state.source, prep)}</dialog>
    <dialog class="lightbox" id="lightbox" aria-label="Фотография">${renderLightbox()}</dialog>
  </div>`;
}

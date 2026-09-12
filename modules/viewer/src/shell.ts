import type { FlatModel } from '@flatwalk/contract';
import { listingView } from './view-model';
import type { DataSource } from './source';
import type { ReportResult } from './load-report';
import { buildOverlay, renderOverlaySvg } from './plan-overlay';
import { renderAbout, renderAssumptionStrip, renderLightbox, renderRoomList, renderRoomPanel, renderStageStatus, renderWalkHud, walkTitle } from './panels';
import { walkVerification } from './report-status';
import { DEMO_DISCLOSURE, SYNTHETIC_DISCLOSURE, SYNTHETIC_FIXTURE_DISCLOSURE, isSyntheticModel } from './demo-flags';
import type { WalkPrep } from './walk-prep';
import { escapeHtml, icon } from './html';

export type ViewerState =
  | { kind: 'loading'; demo?: boolean }
  | { kind: 'missing'; source: DataSource; url: string; demo?: boolean }
  | { kind: 'invalid'; issues: string[]; demo?: boolean }
  | {
      kind: 'ready';
      model: FlatModel;
      source: DataSource;
      plan: { status: 'ok' | 'unavailable' };
      report?: ReportResult;
      prep?: WalkPrep;
      demo?: boolean;
      syntheticFixture?: boolean;
    };

const NO_REPORT: ReportResult = { status: 'missing', url: '' };

function disclosureBanner(demo: boolean | undefined, synthetic: boolean, syntheticFixture = false): string {
  if (synthetic) return `<div class="demo-disclosure is-synthetic" role="note">${escapeHtml(SYNTHETIC_DISCLOSURE)}</div>`;
  if (syntheticFixture) return `<div class="demo-disclosure is-synthetic" role="note">${escapeHtml(SYNTHETIC_FIXTURE_DISCLOSURE)}</div>`;
  if (!demo) return '';
  return `<div class="demo-disclosure" role="note">${escapeHtml(DEMO_DISCLOSURE)}</div>`;
}

function page(kind: string, body: string, demo?: boolean, synthetic = false): string {
  return `${disclosureBanner(demo, synthetic)}<div class="page page-${kind}">
      <p class="brand">FlatWalk</p>
      ${body}
    </div>`;
}

export function renderShell(state: ViewerState): string {
  if (state.kind === 'loading') {
    return page('loading', `<p class="status" role="status"><span class="spinner" aria-hidden="true"></span>Loading model…</p>`, state.demo);
  }

  if (state.kind === 'missing') {
    if (state.source.kind === 'job') {
      return page('missing', `<h1>Job model not found</h1>
        <p>The job API did not return a FlatModel at <code>${escapeHtml(state.url)}</code>. Source materials from the job stay on the job page; this screen does not substitute the prepared 54541 demo.</p>
        <p class="actions"><a class="button" href="./">Start another job</a><a class="button is-secondary" href="?src=fixture&demo=1">Open prepared demo</a></p>`, state.demo);
    }
    if (state.source.kind === 'fixture') {
      return page('missing', `<h1>Reference model 54541 is unavailable</h1>
        <p>The file <code>${escapeHtml(state.url)}</code> is not available next to Viewer. The reference is produced separately and is not replaced with test data.</p>
        <p class="actions"><a class="button" href="./">Open the run-folder model</a><button type="button" class="button is-secondary" data-action="reload">Check again</button></p>`, state.demo);
    }
    return page('missing', `<h1>Model not found</h1>
      <p>The file <code>${escapeHtml(state.url)}</code> is missing. Put <code>latest.json</code> in the run folder and open Viewer with <code>FLATWALK_RUN</code>, or view the reference model.</p>
      <p class="actions"><a class="button" href="?src=fixture">Open reference model 54541</a><button type="button" class="button is-secondary" data-action="reload">Check again</button></p>`, state.demo);
  }

  if (state.kind === 'invalid') {
    const items = state.issues.map((issue) => `<li><code>${escapeHtml(issue)}</code></li>`).join('');
    return page('invalid', `<h1>Model validation failed</h1>
      <p>The FlatModel contract rejected the file with ${state.issues.length} ${state.issues.length === 1 ? 'issue' : 'issues'}. Viewer does not duplicate the schema, so the model file must be corrected.</p>
      <details class="issues"><summary>Show contract issues</summary><ul>${items}</ul></details>
      <p class="actions"><button type="button" class="button" data-action="reload">Check again</button><a class="button is-secondary" href="?src=fixture">Open reference model 54541</a></p>`, state.demo);
  }

  const view = listingView(state.model, state.source);
  const report = state.report ?? NO_REPORT;
  const overlay = buildOverlay(state.model, view.plan, state.plan.status === 'ok');
  const stage = overlay.mode === 'empty'
    ? `<div class="stage-empty"><p>The source floor plan is unavailable and the model has no geometry yet.</p><p class="muted">An annotated floor plan will appear here when Parser returns the walls.</p></div>`
    : renderOverlaySvg(overlay);
  const synthetic = isSyntheticModel(state.model);
  const syntheticFixture = Boolean(state.syntheticFixture) && !synthetic;
  const sourceChip = synthetic
    ? 'Test model, not a listing'
    : syntheticFixture
      ? 'Fixture job, synthetic geometry'
      : state.source.kind === 'fixture'
        ? 'Prepared demo 54541'
        : state.source.kind === 'job'
          ? 'Job result'
          : 'Run folder';
  const prep = state.prep;
  const hasScene = Boolean(prep?.scene);
  const verification = walkVerification(report);
  const walkable = Boolean(prep?.walk.available) && verification.level !== 'not-ready';
  const walkLabel = walkTitle(verification);
  const walkHint = !prep
    ? 'after the 3D scene is built'
    : !prep.walk.available ? `unavailable: ${prep.walk.reason}`
      : verification.level === 'ready' ? 'WASD and mouse, Esc to exit'
        : verification.level === 'trial' ? 'clearance is unverified; WASD and mouse, Esc to exit'
          : 'geometry is not confirmed by the report; WASD and mouse, Esc to exit';
  const sceneEmpty = hasScene
    ? ''
    : `<p class="scene-empty">The 3D scene has not been built: ${escapeHtml(prep?.sceneError ?? 'Builder is not connected')}.</p>`;
  const listingLink = view.source.url
    ? `<a class="topbar-link" href="${escapeHtml(view.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(view.source.siteLabel)}${icon('external')}</a>`
    : `<span>${escapeHtml(view.source.siteLabel)}</span>`;

  return `<div class="app" data-view="plan" data-marks="on"${state.demo || synthetic || syntheticFixture ? ' data-demo="1"' : ''}>
    ${disclosureBanner(state.demo, synthetic, syntheticFixture)}
    <header class="topbar">
      <a class="brand" href="./">FlatWalk</a>
      <div class="topbar-title">
        <h1>${escapeHtml(view.title)}</h1>
        <p class="topbar-meta">${listingLink}<span class="topbar-sep" aria-hidden="true"></span><span>revision ${view.revision}</span></p>
      </div>
      <div class="topbar-actions">
        <span class="chip" title="Static mode: changes are not saved and Convex is not connected">Static mode, ${escapeHtml(sourceChip.toLowerCase())}</span>
        <button type="button" class="text-button" data-action="about">${icon('info')}About the model</button>
      </div>
    </header>
    <main class="workspace">
      <section class="stage" aria-label="Apartment from above">
        <div class="stage-toolbar">
          <div class="segmented" role="group" aria-label="View">
            <button type="button" data-view="plan" aria-pressed="true">${icon('plan')}Floor plan</button>
            <button type="button" data-view="top" aria-pressed="false"${hasScene ? '' : ' disabled'}>${icon('layers')}Top view</button>
            <button type="button" data-view="scene" aria-pressed="false">${icon('cube')}Overview</button>
          </div>
          <button type="button" class="toggle" data-action="toggle-marks" aria-pressed="true"${overlay.mode === 'plan' ? '' : ' hidden'}>${icon('marks')}Model overlay</button>
          <div class="walk">
            <button type="button" class="walk-button" data-action="walk" data-label="${escapeHtml(walkLabel)}"${walkable ? '' : ' disabled'} aria-describedby="walk-hint">${icon('walk')}<span class="walk-label">${escapeHtml(walkLabel)}</span></button>
            <span id="walk-hint" class="walk-hint">${escapeHtml(walkHint)}</span>
          </div>
          <button type="button" class="icon-button stage-fullscreen" data-action="fullscreen" aria-label="Full screen" title="Full screen">${icon('expand')}</button>
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
        <nav class="room-list" id="room-list" aria-label="Rooms">${renderRoomList(view, 'all')}</nav>
        <section class="room-panel" id="room-panel" aria-live="polite">${renderRoomPanel(view, 'all')}</section>
      </aside>
    </main>
    <footer class="assumptions" id="assumption-strip">${renderAssumptionStrip(view, report)}</footer>
    <dialog class="dialog about" id="about-dialog" aria-labelledby="about-title">${renderAbout(view, report, state.source, prep, { demo: Boolean(state.demo), synthetic, syntheticFixture })}</dialog>
    <dialog class="lightbox" id="lightbox" aria-label="Photo">${renderLightbox()}</dialog>
  </div>`;
}

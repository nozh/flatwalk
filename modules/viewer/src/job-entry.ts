import {
  JobApiError,
  jobFailureReasons,
  jobStageLines,
  loadJobSnapshot,
  materialAbsoluteUrl,
  pollJobSnapshot,
  submitListingJob,
  type JobSnapshot,
} from './job-api';
import { escapeHtml } from './html';

export type JobEntryHandlers = {
  origin: string;
  jobId?: string;
  openPreparedDemo: () => Promise<void>;
  openJobResult: (snapshot: JobSnapshot) => Promise<void>;
};

const FIXTURE_BODY = { from: 'fixtures/54541', adapters: 'fixture' as const };

export function mountJobEntry(root: HTMLElement, handlers: JobEntryHandlers): () => void {
  const abort = new AbortController();
  let busy = false;
  let activeJobId = handlers.jobId;

  const paint = (html: string) => {
    root.innerHTML = html;
    bind();
  };

  const bind = () => {
    root.querySelector('[data-action="prepared-demo"]')?.addEventListener('click', () => {
      abort.abort();
      void handlers.openPreparedDemo();
    });
    root.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      void startFixtureJob();
    });
    root.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      void startFixtureJob();
    });
  };

  const startFixtureJob = async () => {
    if (busy) return;
    busy = true;
    setBusy(true);
    try {
      const created = await submitListingJob(handlers.origin, FIXTURE_BODY, { signal: abort.signal });
      activeJobId = created.job.id;
      replaceJobUrl(created.job.id);
      await watch(created.job.id);
    } catch (error) {
      busy = false;
      setBusy(false);
      if (isAbort(error)) return;
      paint(renderUnavailable(error));
    }
  };

  const watch = async (jobId: string) => {
    busy = true;
    try {
      const snapshot = await pollJobSnapshot(handlers.origin, jobId, {
        signal: abort.signal,
        onUpdate: (next) => paint(renderProgress(next)),
      });
      if (snapshot.job.status === 'failed' || snapshot.job.status === 'cancelled') {
        busy = false;
        paint(renderFailed(handlers.origin, snapshot));
        return;
      }
      await handlers.openJobResult(snapshot);
    } catch (error) {
      busy = false;
      if (isAbort(error)) return;
      paint(renderUnavailable(error, jobId));
    }
  };

  const setBusy = (value: boolean) => {
    root.querySelectorAll('button[data-submit], button[data-action="retry"]').forEach((button) => {
      (button as HTMLButtonElement).disabled = value;
    });
  };

  if (activeJobId) {
    paint(renderProgress({
      job: { id: activeJobId, status: 'queued', stage: 'import' },
      runs: [],
      materials: [],
    }));
    void (async () => {
      try {
        const existing = await loadJobSnapshot(handlers.origin, activeJobId!, { signal: abort.signal });
        if (existing.job.status === 'failed' || existing.job.status === 'cancelled') {
          paint(renderFailed(handlers.origin, existing));
          return;
        }
        if (existing.job.status === 'succeeded' || existing.job.status === 'waiting_for_review') {
          await handlers.openJobResult(existing);
          return;
        }
        await watch(activeJobId!);
      } catch (error) {
        if (isAbort(error)) return;
        paint(renderUnavailable(error, activeJobId));
      }
    })();
  } else {
    paint(renderForm());
  }

  const onLeave = () => abort.abort();
  window.addEventListener('pagehide', onLeave);

  return () => {
    abort.abort();
    window.removeEventListener('pagehide', onLeave);
  };
}

export function replaceJobUrl(jobId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('src');
  url.searchParams.delete('demo');
  url.searchParams.set('job', jobId);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function renderForm(): string {
  return shell(`
    <p class="demo-note">This local job API runs the existing CLI chain. The default action is the 54541 fixture pipeline (synthetic grok-rects). It does not call paid live APIs. Open prepared demo is a separate labelled fallback and is not used when a job fails.</p>
    <form>
      <button type="submit" data-submit>Run fixture job →</button>
    </form>
    <p class="demo-note">Listing photos, if present, are source materials. Fixture geometry is not recognized from those photos.</p>
    <ol aria-live="polite" class="demo-steps"></ol>
    <button class="demo-skip" type="button" data-action="prepared-demo">Open prepared demo</button>
  `);
}

function renderProgress(snapshot: JobSnapshot): string {
  const lines = jobStageLines(snapshot).map((line) => {
    const status = line.state === 'current' ? 'In progress'
      : line.state === 'success' ? 'Done'
        : line.state === 'failure' ? 'Failed'
          : line.state === 'unavailable' ? 'Unavailable'
            : line.state === 'skipped' ? 'Skipped'
              : 'Waiting';
    const detail = line.detail ? ` — ${escapeHtml(line.detail)}` : '';
    return `<li data-stage="${escapeHtml(line.stage)}" data-state="${line.state}"><span>${escapeHtml(line.label)}</span> <span class="demo-note">${status}${detail}</span></li>`;
  }).join('');
  return shell(`
    <p class="demo-note" role="status">Job ${escapeHtml(snapshot.job.id)} · ${escapeHtml(snapshot.job.status)} · ${escapeHtml(String(snapshot.job.stage))}</p>
    <ol aria-live="polite" class="demo-steps">${lines}</ol>
    <button class="demo-skip" type="button" data-action="prepared-demo">Open prepared demo</button>
  `);
}

function renderFailed(origin: string, snapshot: JobSnapshot): string {
  const reasons = jobFailureReasons(snapshot);
  const reasonList = reasons.length
    ? `<ul class="demo-reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>`
    : '<p>The job failed without a detailed reason.</p>';
  const materials = snapshot.materials.map((item) => {
    const href = materialAbsoluteUrl(origin, snapshot.job.id, item.url);
    return `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.kind)} · ${escapeHtml(item.assetId)}</a></li>`;
  }).join('');
  return shell(`
    <div data-job-failed="1">
      <p role="alert"><b>Job failed.</b> The prepared demo was not opened automatically.</p>
      ${reasonList}
      ${materials ? `<p>Available source materials</p><ul class="demo-materials">${materials}</ul>` : '<p>No source materials were stored for this job.</p>'}
      <p class="actions"><button type="button" data-action="retry" data-submit>Retry job</button></p>
      <button class="demo-skip" type="button" data-action="prepared-demo">Open prepared demo</button>
    </div>
  `);
}

function renderUnavailable(error: unknown, jobId?: string): string {
  const status = error instanceof JobApiError ? error.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const apiDown = status === undefined || status >= 500 || message.includes('Failed to fetch') || message.includes('NetworkError');
  const title = apiDown || status === 0 ? 'Job API is unavailable' : 'Could not load this job';
  return shell(`
    <p role="alert"><b>${escapeHtml(title)}.</b> ${escapeHtml(message)}</p>
    ${jobId ? `<p class="demo-note">Job ID ${escapeHtml(jobId)} is still in the URL. Retry starts a new job; it does not reopen the prepared demo.</p>` : ''}
    <p class="actions"><button type="button" data-action="retry" data-submit>Retry job</button></p>
    <button class="demo-skip" type="button" data-action="prepared-demo">Open prepared demo</button>
  `);
}

function shell(body: string): string {
  return `<main class="demo-entry"><div class="demo-card"><span class="demo-badge">FLATWALK · LOCAL JOB</span><h1>From a listing —<br>into the apartment</h1><p>Explore the floor plan and photos, then walk through the apartment in 3D.</p>${body}</div></main>`;
}

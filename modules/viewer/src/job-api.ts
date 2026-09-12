/** Browser helper for the listing job API. Does not start a second pipeline. */

export type JobStatus = 'queued' | 'running' | 'waiting_for_review' | 'succeeded' | 'failed' | 'cancelled';
export type JobStage = 'import' | 'parse' | 'validate' | 'repair' | 'match' | 'dress' | 'publish';
export type StageOutcome = 'success' | 'failure' | 'unavailable' | 'skipped';

export type JobSnapshot = {
  job: {
    id: string;
    status: JobStatus;
    stage: JobStage | string;
    adapters?: 'fixture' | 'live';
    error?: string;
    modelId?: string;
    revision?: number;
    walkReady?: boolean;
  };
  runs: Array<{
    stage: string;
    outcome: StageOutcome | string;
    error?: string;
    diagnostics?: Record<string, unknown>;
  }>;
  materials: Array<{ assetId: string; kind: string; url: string }>;
  model?: { id: string; revision: number; [key: string]: unknown };
  report?: { modelId: string; revision: number; walkReady: boolean; [key: string]: unknown };
};

export const TERMINAL_JOB_STATUS: ReadonlySet<JobStatus> = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'waiting_for_review',
]);

export const JOB_STAGE_ORDER: JobStage[] = ['import', 'parse', 'validate', 'repair', 'match', 'dress', 'publish'];

export const JOB_STAGE_LABEL: Record<JobStage, string> = {
  import: 'Listing materials',
  parse: 'Floor-plan geometry',
  validate: 'Validation',
  repair: 'Geometry repair',
  match: 'Photo matching',
  dress: 'Interior finish',
  publish: 'Publishing the 3D model',
};

export function isTerminalJobStatus(status: string): status is JobStatus {
  return TERMINAL_JOB_STATUS.has(status as JobStatus);
}

export function jobApiBase(): string | undefined {
  const jobs = import.meta.env.VITE_JOB_API_URL as string | undefined;
  if (typeof jobs === 'string' && jobs.trim()) return jobs.replace(/\/+$/, '');
  return undefined;
}

export async function submitListingJob(
  origin: string,
  body: { url?: string; from?: string; adapters?: 'fixture' | 'live' },
  init: { signal?: AbortSignal } = {},
): Promise<{ job: { id: string } }> {
  const response = await fetch(`${origin}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  if (!response.ok) {
    throw new JobApiError(`Job API ${response.status}`, response.status);
  }
  return (await response.json()) as { job: { id: string } };
}

export async function loadJobSnapshot(origin: string, jobId: string, init: { signal?: AbortSignal } = {}): Promise<JobSnapshot> {
  if (init.signal?.aborted) throw new DOMException('Polling stopped', 'AbortError');
  const response = await fetch(`${origin}/api/jobs/${jobId}`, { cache: 'no-store', signal: init.signal });
  if (response.status === 404) throw new JobApiError(`Job ${jobId} was not found`, 404);
  if (!response.ok) throw new JobApiError(`Job ${jobId} ${response.status}`, response.status);
  return (await response.json()) as JobSnapshot;
}

export function materialAbsoluteUrl(origin: string, jobId: string, url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/api/jobs/')) return `${origin.replace(/\/+$/, '')}${url}`;
  const cleaned = url.replace(/^\.\//, '').replace(/^\/+/, '');
  return `${origin.replace(/\/+$/, '')}/api/jobs/${jobId}/file/${cleaned}`;
}

export type JobStageLine = {
  stage: string;
  label: string;
  state: 'pending' | 'current' | 'success' | 'failure' | 'unavailable' | 'skipped';
  detail?: string;
};

export function jobStageLines(snapshot: JobSnapshot): JobStageLine[] {
  const byStage = new Map(snapshot.runs.map((run) => [run.stage, run]));
  const current = snapshot.job.stage;
  return JOB_STAGE_ORDER.map((stage) => {
    const run = byStage.get(stage);
    const label = JOB_STAGE_LABEL[stage];
    if (run?.outcome === 'failure') return { stage, label, state: 'failure', detail: run.error };
    if (run?.outcome === 'unavailable') {
      return { stage, label, state: 'unavailable', detail: diagnosticReason(run.diagnostics) ?? 'Unavailable in this slice' };
    }
    if (run?.outcome === 'skipped') return { stage, label, state: 'skipped', detail: diagnosticReason(run.diagnostics) };
    if (run?.outcome === 'success') return { stage, label, state: 'success' };
    if (stage === current && !isTerminalJobStatus(snapshot.job.status)) return { stage, label, state: 'current' };
    return { stage, label, state: 'pending' };
  });
}

function diagnosticReason(diagnostics: Record<string, unknown> | undefined): string | undefined {
  if (!diagnostics) return undefined;
  if (typeof diagnostics.reason === 'string') return diagnostics.reason;
  return undefined;
}

export function parseRunIsSynthetic(snapshot: JobSnapshot): boolean {
  if (snapshot.job.adapters === 'live') return false;
  const parse = snapshot.runs.find((run) => run.stage === 'parse');
  const grok = parse?.diagnostics?.grokRects;
  if (grok && typeof grok === 'object' && (grok as { synthetic?: unknown }).synthetic === true) return true;
  if (parse?.diagnostics?.synthetic === true) return true;
  return snapshot.job.adapters === 'fixture' && modelHasGrokRects(snapshot.model);
}

function modelHasGrokRects(model: JobSnapshot['model']): boolean {
  if (!model || typeof model !== 'object') return false;
  const rooms = (model as { rooms?: Record<string, { meta?: { provenance?: string } }> }).rooms;
  if (!rooms) return false;
  return Object.values(rooms).some((room) => (room.meta?.provenance ?? '').includes('grok-rects'));
}

export function jobFailureReasons(snapshot: JobSnapshot): string[] {
  const reasons: string[] = [];
  if (snapshot.job.error) reasons.push(snapshot.job.error);
  for (const run of snapshot.runs) {
    if (run.outcome === 'failure' && run.error && !reasons.includes(run.error)) reasons.push(run.error);
    if (run.outcome === 'unavailable') {
      const detail = diagnosticReason(run.diagnostics);
      const line = detail ? `${JOB_STAGE_LABEL[run.stage as JobStage] ?? run.stage}: ${detail}` : `${JOB_STAGE_LABEL[run.stage as JobStage] ?? run.stage} is unavailable`;
      if (!reasons.includes(line)) reasons.push(line);
    }
  }
  return reasons;
}

export async function pollJobSnapshot(
  origin: string,
  jobId: string,
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    onUpdate?: (snapshot: JobSnapshot) => void;
  } = {},
): Promise<JobSnapshot> {
  if (options.signal?.aborted) throw new DOMException('Polling stopped', 'AbortError');
  const intervalMs = options.intervalMs ?? 400;
  let snapshot = await loadJobSnapshot(origin, jobId, { signal: options.signal });
  options.onUpdate?.(snapshot);
  while (!isTerminalJobStatus(snapshot.job.status)) {
    if (options.signal?.aborted) throw new DOMException('Polling stopped', 'AbortError');
    await wait(intervalMs, options.signal);
    snapshot = await loadJobSnapshot(origin, jobId, { signal: options.signal });
    options.onUpdate?.(snapshot);
  }
  return snapshot;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Polling stopped', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Polling stopped', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class JobApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'JobApiError';
    this.status = status;
  }
}

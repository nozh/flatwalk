import { describe, expect, it, vi } from 'vitest';
import {
  isTerminalJobStatus,
  jobFailureReasons,
  jobStageLines,
  materialAbsoluteUrl,
  parseRunIsSynthetic,
  pollJobSnapshot,
  type JobSnapshot,
} from '../src/job-api';

function snapshot(partial: Partial<JobSnapshot> & Pick<JobSnapshot, 'job'>): JobSnapshot {
  return { runs: [], materials: [], ...partial };
}

describe('job API helpers', () => {
  it('stops treating waiting_for_review as an in-flight status', () => {
    expect(isTerminalJobStatus('succeeded')).toBe(true);
    expect(isTerminalJobStatus('failed')).toBe(true);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
    expect(isTerminalJobStatus('waiting_for_review')).toBe(true);
    expect(isTerminalJobStatus('running')).toBe(false);
  });

  it('labels fixture grok-rects without treating live adapters as the packaged fixture', () => {
    expect(parseRunIsSynthetic(snapshot({
      job: { id: '1', status: 'succeeded', stage: 'publish', adapters: 'fixture' },
      runs: [{ stage: 'parse', outcome: 'success', diagnostics: { grokRects: { synthetic: true } } }],
    }))).toBe(true);
    expect(parseRunIsSynthetic(snapshot({
      job: { id: '1', status: 'succeeded', stage: 'publish', adapters: 'live' },
      runs: [{ stage: 'parse', outcome: 'success', diagnostics: { grokRects: { synthetic: false, liveApiCalled: true } } }],
    }))).toBe(false);
  });

  it('lists failed and unavailable stages without hiding source-material failures', () => {
    const view = snapshot({
      job: { id: '1', status: 'failed', stage: 'parse', error: 'parser crashed' },
      runs: [
        { stage: 'import', outcome: 'success' },
        { stage: 'parse', outcome: 'failure', error: 'parser crashed' },
        { stage: 'match', outcome: 'unavailable', diagnostics: { reason: 'Matcher is not wired' } },
      ],
    });
    expect(jobFailureReasons(view)).toEqual([
      'parser crashed',
      'Photo matching: Matcher is not wired',
    ]);
    expect(jobStageLines(view).find((line) => line.stage === 'parse')?.state).toBe('failure');
    expect(jobStageLines(view).find((line) => line.stage === 'match')?.state).toBe('unavailable');
  });

  it('prefixes job file paths with the API origin', () => {
    expect(materialAbsoluteUrl('http://127.0.0.1:8787', 'abc', '/api/jobs/abc/file/materials/plan.png'))
      .toBe('http://127.0.0.1:8787/api/jobs/abc/file/materials/plan.png');
  });

  it('stops polling on a terminal snapshot and when the page aborts', async () => {
    const running: JobSnapshot = snapshot({ job: { id: 'j1', status: 'running', stage: 'parse' } });
    const done: JobSnapshot = snapshot({ job: { id: 'j1', status: 'succeeded', stage: 'publish' } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => running })
      .mockResolvedValueOnce({ ok: true, json: async () => done });
    vi.stubGlobal('fetch', fetchMock);
    const updates: string[] = [];
    const result = await pollJobSnapshot('http://127.0.0.1:9', 'j1', {
      intervalMs: 1,
      onUpdate: (next) => updates.push(next.job.status),
    });
    expect(result.job.status).toBe('succeeded');
    expect(updates).toEqual(['running', 'succeeded']);

    const abort = new AbortController();
    abort.abort();
    await expect(pollJobSnapshot('http://127.0.0.1:9', 'j1', { signal: abort.signal, intervalMs: 1 }))
      .rejects.toMatchObject({ name: 'AbortError' });
    vi.unstubAllGlobals();
  });
});

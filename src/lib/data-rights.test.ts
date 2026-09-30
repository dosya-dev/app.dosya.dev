import { describe, it, expect } from 'vitest';
import { ApiError } from '@/api/client';
import {
  answerState, cooldownLabel, deadlineLabel, describeAnswer, describeArchives, dueDateLabel, errorCopy,
  expiresLabel, manifestUrl, partUrls, reportUrl,
  type ExportSummary, type RequestState,
} from './data-rights';

const ASKED = 1_790_672_400;          // 29 September 2026, 09:00 UTC
const DUE = ASKED + 30 * 86400;       // 29 October 2026

const summary: ExportSummary = {
  id: 'exp_1', created_at: ASKED + 240, expires_at: ASKED + 7 * 86400,
  workspace_count: 2, file_count: 1240, total_bytes: 3 * 1024 ** 3, part_count: 2, manifest_bytes: 2048,
  parts: [
    { part: 1, workspace_id: 'ws_1', workspace_name: 'Acme', filename: 'dosya-export-acme-part-1-of-2.zip', file_count: 1000, bytes: 2 * 1024 ** 3 },
    { part: 2, workspace_id: 'ws_1', workspace_name: 'Acme', filename: 'dosya-export-acme-part-2-of-2.zip', file_count: 240, bytes: 1024 ** 3 },
  ],
};

const request: RequestState = {
  id: 'drq_1', kind: 'access', status: 'answered',
  requested_at: ASKED, due_at: DUE, verified_at: ASKED + 120, answered_at: ASKED + 240,
  retry_at: null, note: null, export: summary, had_export: true, code_pending: true,
};

describe('download URLs', () => {
  it('builds report, manifest and part URLs from the API base', () => {
    expect(reportUrl('https://api.dosya.dev', 'exp_1')).toBe('https://api.dosya.dev/api/me/export/exp_1/report');
    expect(manifestUrl('', 'exp_1')).toBe('/api/me/export/exp_1/manifest');
    expect(partUrls('', summary)).toEqual([
      '/api/me/export/exp_1/parts/1',
      '/api/me/export/exp_1/parts/2',
    ]);
  });

  it('escapes an id rather than pasting it into the path', () => {
    expect(reportUrl('', 'exp/../1')).toBe('/api/me/export/exp%2F..%2F1/report');
  });
});

describe('answerState', () => {
  it('is none when nothing was ever asked', () => {
    expect(answerState(null)).toBe('none');
  });

  it('is awaiting_code while the emailed code is outstanding', () => {
    expect(answerState({ ...request, status: 'pending', answered_at: null, export: null })).toBe('awaiting_code');
  });

  it('stays awaiting_code for a reopened request that still carries an old verified_at', () => {
    // The trap: a second ask reads 'pending' with verified_at stamped from the
    // first one. A client that infers the step from the timestamp shows a
    // ready screen for a code the server has already invalidated.
    expect(answerState({
      ...request, status: 'pending', verified_at: ASKED - 86400, answered_at: null, export: null,
    })).toBe('awaiting_code');
  });

  /**
   * 'pending' is two states. An admin who records a request that arrived by
   * email writes a pending row and sends no code, and openRequest reuses that
   * row when the same person later asks in the app - so reading 'pending' as
   * "a code is waiting to be entered" put them in front of a code box for an
   * email nobody had sent, with no way out of the screen.
   */
  it('is asked, not awaiting_code, when no live code is outstanding', () => {
    expect(answerState({
      ...request, status: 'pending', answered_at: null, export: null, code_pending: false,
    })).toBe('asked');
  });

  it('is asked once a code has expired unused', () => {
    // Same dead end, slower: the 15 minutes ran out and the digits in the box
    // would be refused. code_pending is false, so the page offers a new one.
    expect(answerState({
      ...request, status: 'pending', verified_at: null, answered_at: null, export: null,
      retry_at: null, code_pending: false,
    })).toBe('asked');
  });

  it('is building when the code was accepted but nothing is attached yet', () => {
    expect(answerState({ ...request, status: 'verified', answered_at: null, export: null })).toBe('building');
  });

  it('is still partial once the report expired, because the note says a delivery happened', () => {
    // Exports live 7 days, requests stay open 30. Without this, three weeks of
    // "the report was delivered, the archives are owed" read as "we are putting
    // your copy together" - and the note beside it said otherwise.
    expect(answerState({
      ...request, status: 'verified', answered_at: null, export: null,
      note: 'Partly answered: the report was delivered ...',
    })).toBe('partial');
  });

  it('is partial when verified with an export attached', () => {
    expect(answerState({ ...request, status: 'verified', answered_at: null })).toBe('partial');
  });

  it('is answered on status answered, not on the timestamp', () => {
    expect(answerState(request)).toBe('answered');
    expect(answerState({ ...request, answered_at: null })).toBe('answered');
  });

  it('is failed when our own build gave up', () => {
    expect(answerState({ ...request, status: 'failed', answered_at: null, export: null })).toBe('failed');
  });

  it('is none for a request staff cancelled', () => {
    expect(answerState({ ...request, status: 'cancelled', answered_at: null, export: null })).toBe('none');
  });
});

describe('describeAnswer', () => {
  it('names the day asked and how long the answer took', () => {
    expect(describeAnswer(request, DUE)).toBe('Asked 29 September, answered in 4 minutes');
  });

  it('measures a partial delivery from the export we did manage to build', () => {
    expect(describeAnswer({ ...request, status: 'verified', answered_at: null }, DUE))
      .toBe('Asked 29 September, partly answered in 4 minutes');
  });

  it('still says we answered once the download is gone', () => {
    // The record outlives the file: this sentence is the only place the person
    // can read back that we answered, and when, after the copy expires.
    expect(describeAnswer({ ...request, export: null }, DUE))
      .toBe('Asked 29 September, answered in 4 minutes');
    expect(describeAnswer({
      ...request, status: 'verified', answered_at: null, export: null, note: 'Partly answered: ...',
    }, DUE)).toBe('Asked 29 September, partly answered');
  });

  it('says how long an unanswered request has been open', () => {
    const open = { ...request, status: 'pending' as const, answered_at: null, export: null };
    expect(describeAnswer(open, ASKED + 3 * 86400)).toBe('Asked 29 September, open for 3 days');
    expect(describeAnswer(open, ASKED + 30)).toBe('Asked 29 September, open for less than a minute');
  });

  it('carries the year when the ask was not this year', () => {
    expect(describeAnswer(request, DUE + 400 * 86400)).toContain('Asked 29 September 2026,');
  });

  it('rounds the duration up the scale', () => {
    expect(describeAnswer({ ...request, answered_at: ASKED + 30 }, DUE)).toContain('answered in less than a minute');
    expect(describeAnswer({ ...request, answered_at: ASKED + 60 }, DUE)).toContain('answered in 1 minute');
    expect(describeAnswer({ ...request, answered_at: ASKED + 7200 }, DUE)).toContain('answered in 2 hours');
    expect(describeAnswer({ ...request, answered_at: ASKED + 86400 }, DUE)).toContain('answered in 1 day');
  });
});

describe('deadlineLabel', () => {
  it('states the statutory date in full', () => {
    expect(deadlineLabel(DUE)).toBe('We must answer by 29 October 2026');
  });

  it('offers the bare date for a request that is already answered', () => {
    expect(dueDateLabel(DUE)).toBe('29 October 2026');
  });
});

describe('cooldownLabel', () => {
  it('counts a resend cooldown in seconds', () => {
    expect(cooldownLabel(ASKED + 43, ASKED)).toBe('in 43 seconds');
    expect(cooldownLabel(ASKED + 1, ASKED)).toBe('in 1 second');
  });

  it('keeps the minute and hour rounding above a minute', () => {
    expect(cooldownLabel(ASKED + 90, ASKED)).toBe('in 2 minutes');
    expect(cooldownLabel(ASKED + 3600, ASKED)).toBe('in 1 hour');
    expect(cooldownLabel(ASKED + 5 * 3600 + 20, ASKED)).toBe('in 5 hours');
  });

  it('is null once the moment has passed, or when there is none', () => {
    expect(cooldownLabel(ASKED, ASKED)).toBeNull();
    expect(cooldownLabel(null, ASKED)).toBeNull();
  });
});

describe('describeArchives and expiresLabel', () => {
  it('describes the archives in one sentence', () => {
    expect(describeArchives(summary)).toBe('1,240 files you uploaded, across 2 workspaces - 3.00 GB in 2 archives.');
    expect(describeArchives({ ...summary, file_count: 1, workspace_count: 1, part_count: 1, total_bytes: 10 }))
      .toBe('1 file you uploaded, across 1 workspace - 10 B in 1 archive.');
  });

  it('says plainly when there are no archives at all', () => {
    expect(describeArchives({ ...summary, file_count: 0, part_count: 0, total_bytes: 0, parts: [] }))
      .toBe('No file archives: we found no files uploaded by you.');
  });

  it('labels expiry in days', () => {
    expect(expiresLabel(ASKED + 7 * 86400, ASKED)).toBe('in 7 days');
    expect(expiresLabel(ASKED + 86400, ASKED)).toBe('in 1 day');
    expect(expiresLabel(ASKED + 3600, ASKED)).toBe('in less than a day');
  });
});

describe('errorCopy', () => {
  const thrown = (status: number, body: unknown) => new ApiError(status, JSON.stringify(body));

  it('passes the server sentence through for the code errors', () => {
    expect(errorCopy(thrown(400, { ok: false, error: 'That code is not correct.' })).text)
      .toBe('That code is not correct.');
    expect(errorCopy(thrown(429, { ok: false, error: 'Too many incorrect attempts. Request a new code.' })).text)
      .toBe('Too many incorrect attempts. Request a new code.');
  });

  it('never says a request was refused when a code was merely just sent', () => {
    const copy = errorCopy(
      thrown(429, { ok: false, error: 'A code was just sent. Check your inbox, or wait a minute to request another.', retry_at: ASKED + 40 }),
    );
    expect(copy.text).toBe('A code was just sent. Check your inbox, or wait a minute to request another.');
    expect(copy.retryAt).toBe(ASKED + 40);
  });

  it('keeps a failed build an open request rather than a dead end', () => {
    expect(errorCopy(thrown(500, { ok: false, error: 'build_failed' })).text).toContain('still open');
  });

  it('explains a closed request and a delivery we could not record', () => {
    expect(errorCopy(thrown(409, { ok: false, error: 'request_closed' })).text)
      .toContain('already been answered');
    expect(errorCopy(thrown(500, { ok: false, error: 'not_recorded' })).text)
      .toContain('privacy@dosya.dev');
  });

  it('falls back for a network failure', () => {
    expect(errorCopy(new TypeError('offline')).text).toContain('try again');
  });
});

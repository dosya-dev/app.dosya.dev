/**
 * Pure logic behind "Privacy and your data".
 *
 * Replaces the export helpers that drove a "download your stuff" button. What
 * this drives is a legal right with a deadline attached, so the vocabulary
 * changed with it: a request is ASKED and ANSWERED, and the answer is a report
 * (the legal artefact) plus, as a convenience, the file archives.
 *
 * No React in here on purpose - every sentence the section shows is decided by
 * a function that can be read and tested on its own.
 */

import { ApiError, apiErrorCode, apiErrorMessage } from '@/api/client';
import { humanSize } from '@/lib/helpers';

/** Mirrors ExportPartSummary in apps/api/src/lib/account/export/store.ts. */
export interface ExportPart {
  part: number; workspace_id: string; workspace_name: string; filename: string; file_count: number; bytes: number;
}
/** Mirrors ExportSummary in apps/api/src/lib/account/export/store.ts. */
export interface ExportSummary {
  id: string; created_at: number; expires_at: number;
  workspace_count: number; file_count: number; total_bytes: number; part_count: number; manifest_bytes: number;
  parts: ExportPart[];
}

export type RequestKind = 'access' | 'portability' | 'erasure' | 'objection' | 'restriction';
export type RequestStatus = 'pending' | 'verified' | 'answered' | 'failed' | 'cancelled';

/** `request` from GET /api/me/data (apps/api/src/pages/api/me/data/index.ts). */
export interface RequestState {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  requested_at: number;
  due_at: number;
  verified_at: number | null;
  answered_at: number | null;
  /** When a resend will be accepted again; null when it already is. */
  retry_at: number | null;
  /**
   * Whether a live emailed code for this request is actually outstanding.
   *
   * 'pending' does not imply one. A request an admin recorded from an email is
   * pending with no code ever sent, and openRequest reuses that row when the
   * person later asks in the app - so the status alone put people in front of a
   * code box waiting for an email nobody had sent.
   */
  code_pending: boolean;
  /**
   * Why the state is what it is, in the words of whoever set it.
   *
   * The API's `public_note` column, under its original name. It is the
   * person-facing half of a column that used to be both: the internal half -
   * how an asker was identified, what staff said to each other about them -
   * stays in the admin panel and never reaches this app.
   */
  note: string | null;
  export: ExportSummary | null;
  /**
   * Whether a downloadable copy was ever built for this request.
   *
   * Separate from `export`, which is null both for a copy that has EXPIRED and
   * for an answer that never had one. A request closed by hand from the admin
   * queue links no export, and restriction and objection requests are always
   * closed that way - so for two of the five rights, "no export" is the
   * permanent state rather than an expiry.
   */
  had_export: boolean;
}

/**
 * One of this person's OTHER open rights, as GET /api/me/data reports it.
 *
 * Deliberately a different, smaller shape than `RequestState`. There is no
 * code, no export and no button for these: the app's own flow creates and
 * answers access requests only, and the other four arrive through
 * privacy@dosya.dev and are answered by a person. All the page can honestly do
 * is say we have it and when we must answer.
 */
export interface OtherRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  requested_at: number;
  due_at: number;
  /** `public_note` - what staff wrote TO them, if anything. */
  note: string | null;
}

/**
 * The whole GET /api/me/data body.
 *
 * `request` is the newest ACCESS request, and null when none was ever made. It
 * is not "the newest request": a panel that drives one right must not be handed
 * a row belonging to another one. `other_requests` carries the rest.
 */
export interface DataState {
  ok: boolean;
  request: RequestState | null;
  other_requests?: OtherRequest[];
}


// ── Download URLs ──────────────────────────────────────────
//
// Real hrefs, not fetch-and-blob: these are streamed ZIPs of an entire account
// and the browser's own downloader is the only thing that should hold them.

const exportRoot = (base: string, exportId: string) =>
  `${base}/api/me/export/${encodeURIComponent(exportId)}`;

/** The readable report: start-here.html, the CSVs and a copy of the manifest. */
export function reportUrl(base: string, exportId: string): string {
  return `${exportRoot(base, exportId)}/report`;
}

/** The machine-readable manifest, for handing to another service. */
export function manifestUrl(base: string, exportId: string): string {
  return `${exportRoot(base, exportId)}/manifest`;
}

/** One URL per ZIP part, in the summary's own order. */
export function partUrls(base: string, summary: ExportSummary): string[] {
  const root = exportRoot(base, summary.id);
  return summary.parts.map((p) => `${root}/parts/${p.part}`);
}

// ── State ──────────────────────────────────────────────────

/**
 * Where a request has got to.
 *
 * Derived from `status` and whether an export is attached, and from nothing
 * else. Not from `verified_at`: a request asked a second time comes back as
 * 'pending' with `verified_at` still stamped from the first ask, so a client
 * that reads the timestamp shows a code screen for a code the server has
 * already burned. Not from `answered_at` either - it is never written for a
 * partial delivery, which is precisely the state that needs saying out loud.
 */
export type AnswerState = 'none' | 'asked' | 'awaiting_code' | 'building' | 'partial' | 'answered' | 'failed';

export function answerState(request: RequestState | null): AnswerState {
  if (!request) return 'none';
  switch (request.status) {
    // 'pending' is two states, not one, and the difference is whether a code is
    // actually in the person's inbox. Without `code_pending` a request an admin
    // recorded from an email - or one whose code has since expired - showed a
    // code-entry box for a code that will never arrive, with the only way out
    // being a resend the person has no reason to think they need. 'asked' is
    // that request with no live code: recorded, owed an answer, and one button
    // away from the code that starts it.
    case 'pending': return request.code_pending ? 'awaiting_code' : 'asked';
    // 'verified' is an OPEN status: the code was accepted, but the request has
    // not been closed. With an export attached that means a PARTIAL delivery -
    // the report arrived and the archives are still owed.
    //
    // The note carries that same fact past the export's life. Exports last 7
    // days and a request stays open for 30, so from day 8 the summary is gone
    // while the request is still verified - and the only honest reading of
    // "verified, nothing attached, and a note explaining what is owed" is that
    // the delivery already happened and was partial. Without this, three weeks
    // of a legal right read as "we are putting your copy together".
    //
    // That reading is only sound because markPartlyAnswered is the ONLY writer
    // that can leave a person-facing note on a verified row: markVerified
    // clears the column, so anything an earlier attempt said - a failed build's
    // sentence, a note an admin wrote when they recorded the request by email -
    // is gone by the time the status reaches 'verified' again. Both of those
    // rows are reachable (openRequest reuses an open row, keyed on user and
    // kind), and before that clear they made a build IN PROGRESS render as a
    // partial delivery. If markVerified ever stops clearing it, this line stops
    // being true; see the comment on MARK_VERIFIED in apps/api.
    case 'verified': return request.export || request.note ? 'partial' : 'building';
    case 'answered': return 'answered';
    case 'failed': return 'failed';
    // Nothing in any app writes 'cancelled' to data_requests - a close from
    // the admin queue lands on 'answered' - so no row reaches this arm today.
    // It stays because the column's CHECK and the API's own DataRequestStatus
    // both permit the value: a switch that stopped being total would return
    // undefined for a status the schema allows, and the crash would land on
    // somebody exercising a legal right. Nothing outstanding and nothing to
    // download, so a fresh ask is offered exactly as it would be to a newcomer.
    case 'cancelled': return 'none';
  }
}

// ── Sentences ──────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// UTC, and en-GB, everywhere in this module. The deadline is a legal date and
// the confirmation email already prints it this way; a page that renders it in
// the reader's own zone would disagree with the email by a day for half the
// world.
const UTC_DAY = { day: 'numeric', month: 'long', timeZone: 'UTC' } as const;
const UTC_FULL = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } as const;

const utcYear = (seconds: number) => new Date(seconds * 1000).getUTCFullYear();

/** "29 September", or "29 September 2026" once that is no longer this year. */
function dayLabel(seconds: number, now: number): string {
  const d = new Date(seconds * 1000);
  return d.toLocaleDateString('en-GB', utcYear(seconds) === utcYear(now) ? UTC_DAY : UTC_FULL);
}

/** "less than a minute" / "4 minutes" / "2 hours" / "3 days". */
function durationLabel(seconds: number): string {
  if (seconds < 60) return 'less than a minute';
  if (seconds < 3600) return plural(Math.floor(seconds / 60), 'minute', 'minutes');
  if (seconds < 86400) return plural(Math.floor(seconds / 3600), 'hour', 'hours');
  return plural(Math.floor(seconds / 86400), 'day', 'days');
}

/**
 * "Asked 29 September, answered in 4 minutes" - the line that proves to the
 * person, and to anyone they show the page to, that we answered and when.
 *
 * A partial delivery is measured from the export we did build, and says so:
 * calling it "answered" when the archives are still owed would be the page
 * lying on our behalf.
 *
 * Works without an export, on purpose. The copy expires after 7 days; the fact
 * that we answered, and when, does not, and this sentence is the only place the
 * person - or anyone they show the page to - can still read it back.
 */
export function describeAnswer(request: RequestState, now: number): string {
  const asked = `Asked ${dayLabel(request.requested_at, now)}`;
  const state = answerState(request);
  if (state === 'answered') {
    const at = request.answered_at ?? request.export?.created_at ?? null;
    return at === null
      ? `${asked}, answered`
      : `${asked}, answered in ${durationLabel(at - request.requested_at)}`;
  }
  if (state === 'partial') {
    // Once the export is gone so is the moment it was built, and `answered_at`
    // is never written for a partial. Rather than reach for another timestamp,
    // the sentence simply stops saying how long it took.
    return request.export
      ? `${asked}, partly answered in ${durationLabel(request.export.created_at - request.requested_at)}`
      : `${asked}, partly answered`;
  }
  return `${asked}, open for ${durationLabel(Math.max(0, now - request.requested_at))}`;
}

/**
 * The five rights, in the second person, for a sentence that starts "We have
 * your ...". The page's own headings name them differently ("Tell us to stop
 * (objection)") because those introduce the right; this names a request we are
 * already holding.
 */
const KIND_PHRASE: Record<RequestKind, string> = {
  access: 'request for a copy of your data',
  portability: 'request to take your data elsewhere',
  erasure: 'request to have your data deleted',
  objection: 'objection',
  restriction: 'request to pause how we use your data',
};

/**
 * "We have your objection, asked 12 October. We must answer by 11 November 2026."
 *
 * Present tense and our deadline, because every row that reaches here is open -
 * the API only returns the open ones. A closed request of another kind is
 * history the panel says nothing about, which is right: this section is about
 * what we still owe.
 */
export function describeOtherRequest(other: OtherRequest, now: number): string {
  return `We have your ${KIND_PHRASE[other.kind] ?? 'request'}, asked ${dayLabel(other.requested_at, now)}. `
    + `${deadlineLabel(other.due_at)}.`;
}

/** "29 October 2026" - the statutory date on its own. */
export function dueDateLabel(dueAt: number): string {
  return new Date(dueAt * 1000).toLocaleDateString('en-GB', UTC_FULL);
}

/**
 * "We must answer by 29 October 2026" - our deadline, stated as ours.
 *
 * Present tense, so it belongs only beside a request that is still open. An
 * answered one gets `dueDateLabel` in a sentence of its own: telling somebody
 * we must answer by a date we already met reads as a threat to do it again.
 */
export function deadlineLabel(dueAt: number): string {
  return `We must answer by ${dueDateLabel(dueAt)}`;
}

/**
 * "in 43 seconds" / "in 2 minutes" / "in 5 hours"; null once it has passed.
 *
 * The minute and hour rounding is the one the old export helpers settled on.
 * Seconds are new, because the only cooldown left is the 60-second gap between
 * two code emails, and "in 1 minute" for a wait of 43 seconds is a countdown
 * that does not count.
 */
export function cooldownLabel(retryAt: number | null, now: number): string | null {
  if (retryAt == null || retryAt <= now) return null;
  const secs = retryAt - now;
  if (secs >= 3600) return `in ${plural(Math.floor(secs / 3600), 'hour', 'hours')}`;
  if (secs >= 60) return `in ${plural(Math.ceil(secs / 60), 'minute', 'minutes')}`;
  return `in ${plural(secs, 'second', 'seconds')}`;
}

/** What the archives hold, in one sentence. Never describes the report. */
export function describeArchives(summary: ExportSummary): string {
  if (summary.part_count === 0) return 'No file archives: we found no files uploaded by you.';
  const head = `${plural(summary.file_count, 'file', 'files')} you uploaded, across ${plural(summary.workspace_count, 'workspace', 'workspaces')}`;
  return `${head} - ${humanSize(summary.total_bytes)} in ${plural(summary.part_count, 'archive', 'archives')}.`;
}

export function expiresLabel(expiresAt: number, now: number): string {
  const days = Math.floor((expiresAt - now) / 86400);
  if (days < 1) return 'in less than a day';
  return `in ${plural(days, 'day', 'days')}`;
}

// ── Errors ─────────────────────────────────────────────────

/** A 429 body carries the moment the next attempt is accepted. */
function retryAtOf(err: unknown): number | null {
  if (!(err instanceof ApiError)) return null;
  try { return (JSON.parse(err.body) as { retry_at?: number }).retry_at ?? null; } catch { return null; }
}

export interface ErrorCopy {
  text: string;
  /** When the same call will be accepted again, if the server said. */
  retryAt: number | null;
}

/**
 * A failure, as a sentence for the person who hit it.
 *
 * Two rules run through all of it. Nothing here tells someone they were
 * refused, because they never are: a data request is a right, and the only
 * waits in the system are the 60 seconds between two code emails and the hour
 * in which a second ask is handed the copy we just built. And a failure on our
 * side leaves the request OPEN against its deadline, so the copy says that
 * rather than sending the person away.
 *
 * Only codes /api/me/data can really produce are mapped. Sentences for two
 * codes of the ungated export route it replaced were dropped: nothing emits
 * either any more, and one of them promised a complete report in the only
 * world that could have raised it - where the build refused and no report was
 * ever written. Per the note in api/error-copy.ts: a sentence for a code the
 * API never returns reads as coverage that does not exist.
 */
export function errorCopy(err: unknown): ErrorCopy {
  const code = apiErrorCode(err);
  const retryAt = retryAtOf(err);

  if (code === 'build_failed' || code === 'export_failed') {
    return {
      text: 'We could not finish building your copy. Your request is still open and we still owe you an answer - '
        + 'try again, or leave it with us and we will.',
      retryAt,
    };
  }
  if (code === 'request_closed') {
    return {
      text: 'That request has already been answered or closed. Ask again to start a new one.',
      retryAt,
    };
  }
  if (code === 'not_recorded') {
    return {
      text: 'Your copy was built, but we could not record the answer against your request. Reload this page; '
        + 'if it is still missing, write to privacy@dosya.dev and we will sort it out.',
      retryAt,
    };
  }

  // Everything else - the code errors above all - already carries a written
  // sentence from the API, and rewriting those here would put the wording of a
  // legal gate in two places.
  return {
    text: apiErrorMessage(err, 'Something went wrong. Please try again.'),
    retryAt,
  };
}

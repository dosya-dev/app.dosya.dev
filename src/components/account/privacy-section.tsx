import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ChevronRight, Download, FileText, Loader2, Mail, Package, ShieldCheck } from 'lucide-react';
import { humanSize } from '@/lib/helpers';
import { CODE_LENGTH, isCompleteCode, normaliseCode } from '@/lib/account-deletion';
import {
  answerState, cooldownLabel, deadlineLabel, describeAnswer, describeArchives, describeOtherRequest,
  dueDateLabel, errorCopy, expiresLabel, manifestUrl, partUrls, reportUrl,
  type DataState, type ErrorCopy, type RequestState,
} from '@/lib/data-rights';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const PRIVACY_EMAIL = 'privacy@dosya.dev';

/**
 * The five rights the product records a request for - the same five values
 * `data_requests.kind` accepts, so the page and the recorded request name one
 * set. The ORDER is this page's, not the column's: the column reads
 * access, portability, erasure, objection, restriction, and restriction comes
 * before objection here because "ask us to pause" is the milder of the two and
 * reads better ahead of "tell us to stop".
 *
 * Access is first and is the one with a button, because it is the only one we
 * can answer without a human reading anything - and because a right that is
 * hard to find is a right that is hindered (Article 12).
 */
const RIGHTS: { id: string; label: string; body: React.ReactNode }[] = [
  {
    id: 'access',
    label: 'See what we hold (access)',
    body: <>Get a copy of your data, at the top of this section, is how. The report explains what we hold about you, why
      we hold it, who else receives it and how long we keep it. Ask as often as you like.</>,
  },
  {
    id: 'portability',
    label: 'Take it elsewhere (portability)',
    body: <>The report carries <span className="font-mono text-[11px]">account.json</span> and CSV files - structured and
      machine-readable, ready to hand to another service. The archives carry the files themselves.</>,
  },
  {
    id: 'erasure',
    label: 'Have it deleted (erasure)',
    body: <>Deleting your account deletes your profile, your sessions and the files in the workspaces you own. It takes
      effect 30 days later and you can cancel in the meantime. Some things deliberately survive it - the security audit
      trail, billing records we are required to keep, and files you put in someone else's workspace, which are that
      workspace's to delete. Your report's retention section says what and for how long.{' '}
      <Link to="/profile/delete" className="underline underline-offset-2">Delete account</Link> is its own page, under
      Your data.</>,
  },
  {
    id: 'restriction',
    label: 'Ask us to pause (restriction)',
    body: <>If you think what we hold is wrong, or you have objected and we are still considering it, you can ask us to
      keep your data but stop using it while that is sorted out. Write to{' '}
      <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">{PRIVACY_EMAIL}</a>.</>,
  },
  {
    id: 'objection',
    label: 'Tell us to stop (objection)',
    body: <>You can object to anything we do on the basis of our legitimate interests. For marketing email specifically,
      the unsubscribe link and your notification settings work immediately and need no reason. For anything else, write
      to <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">{PRIVACY_EMAIL}</a>.</>,
  },
];

export function PrivacySection({ now = nowSeconds }: { now?: () => number }) {
  const [state, setState] = useState<DataState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCopy | null>(null);
  /**
   * Whether the code dialog is on screen - and nothing more than that.
   *
   * Deliberately NOT derived from `step`. A code already outstanding when the
   * page loads must not throw a dialog at somebody who came to change their
   * avatar, and more to the point a dialog they dismiss must never be the only
   * way to finish: the page keeps a visible row and a button for that, so a
   * dismissal costs a click rather than stranding them with a statutory clock
   * running. The only things that set this true are the ask button (once the
   * request has actually landed) and that row's own button.
   */
  const [codeOpen, setCodeOpen] = useState(false);
  const [rightsOpen, setRightsOpen] = useState(false);
  // Only to re-render the resend countdown; the clock itself is `now`.
  const [, setTick] = useState(0);

  // Returns what it read as well as storing it: `ask` has to decide whether to
  // open the code dialog, and that decision is about the state the server just
  // reported, not the one still in this render's closure.
  const load = useCallback(async (): Promise<DataState | null> => {
    try {
      const next = await api<DataState>('/api/me/data');
      setState(next);
      return next;
    } catch {
      // A failed read says nothing about whether a request can be MADE, so the
      // section still offers one. It only means this page does not know where
      // an existing request has got to.
      setError({ text: 'Could not load your data requests. Reload to try again.', retryAt: null });
      setState({ ok: false, request: null });
      return null;
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The newest ACCESS request, and only that. Every control in this block -
  // the code box, the ask button, the answer - belongs to the one right this
  // app creates and answers, so it must never be driven by a row for another
  // one. See the doc comment on GET /api/me/data.
  const request = state?.request ?? null;
  const step = answerState(request);
  const retryAt = request?.retry_at ?? null;
  const others = state?.other_requests ?? [];

  // A live countdown rather than a dead button: the server rejects a resend
  // inside its 60 seconds, so the control has to say when it will work.
  useEffect(() => {
    if (retryAt == null) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (retryAt <= now()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [retryAt, now]);

  /**
   * Ask, or ask again, or resend. Re-reads the state rather than guessing it
   * from the POST.
   *
   * The typed code is cleared on SUCCESS, never before it. The server burns the
   * outstanding code only once it accepts this call; if it refuses - inside the
   * 60 seconds, or past the hourly cap - nothing was burned and the digits
   * already in the box are still the live code. Clearing them optimistically
   * destroys a working code on our side of a request that never happened.
   */
  const ask = async () => {
    setError(null); setBusy(true);
    try {
      await api('/api/me/data/request', { method: 'POST' });
      // Accepted, so the code that was outstanding really is dead now.
      setCode('');
      // Opened off the RELOADED state, not off the POST: asking is what earns
      // the dialog, but only once a live code really is outstanding. If the
      // request landed in some other state - recorded with no code, already
      // building - the page says so in place and no dialog appears.
      const next = await load();
      if (next && answerState(next.request) === 'awaiting_code') setCodeOpen(true);
    } catch (e) {
      setError(errorCopy(e));
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    setError(null); setBusy(true);
    try {
      await api('/api/me/data/verify', { method: 'POST', body: JSON.stringify({ code }) });
      setCode('');
      // Verified: the dialog has nothing left to ask, so it gets out of the way
      // before the reload swaps the page under it.
      setCodeOpen(false);
      await load();
    } catch (e) {
      // Stay on the code step: a wrong code is a retry, not a dead end, and
      // the server has not burned it unless it said so.
      setError(errorCopy(e));
    } finally { setBusy(false); }
  };

  const askLabel = step === 'failed' ? 'Try again'
    : step === 'answered' || step === 'partial' ? 'Ask again'
      // Already recorded, no live code: the one thing left to do is get one
      // sent, and "Request it" would read as though nothing had been asked.
      : step === 'asked' ? 'Send me a code'
        : 'Request it';

  return (
    <section id="section-privacy">
      <h2 className="text-base font-semibold mb-3">Privacy and your data</h2>
      <Card>
        <CardContent className="divide-y">
          <div className="py-4 space-y-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Get a copy of your data</p>
                <p className="text-sm text-muted-foreground">
                  A readable report of everything we hold about you - what it is, why we have it, who else receives it,
                  where it is stored and how long we keep it - plus ZIP archives of the files you uploaded. We email you
                  a {CODE_LENGTH}-digit code first, and build nothing until you enter it.
                </p>
              </div>
            </div>

            {/* One alert, never two: while the code dialog is up it renders the
                error itself, because an alert behind a modal is an alert nobody
                reads and a wrong code is exactly the moment it matters. */}
            {error && !codeOpen && (
              <p data-testid="privacy-error" role="alert" className="text-xs text-destructive">{error.text}</p>
            )}

            {state === null ? (
              <Skeleton className="h-8 w-40" />
            ) : step === 'awaiting_code' && request ? (
              <>
                {/* The row is the flow, and the dialog is only a nicer place to
                    type. Whatever happens to the dialog - dismissed, Escaped,
                    backdrop-clicked - this stays on the page with a button that
                    brings it back, because the deadline does not pause for a
                    modal somebody closed. */}
                <div
                  data-testid="code-pending"
                  className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-1.5"
                >
                  <p className="text-sm font-medium text-warning">We emailed you a code</p>
                  {request.note && (
                    // The same note the dialog shows. Staff were promised the
                    // person sees what they wrote before we answer, and a note
                    // reachable only behind a dialog they may never open is not
                    // that promise kept.
                    <p data-testid="code-pending-note" className="text-xs text-warning">{request.note}</p>
                  )}
                  <p className="text-xs text-warning">
                    {`Enter the ${CODE_LENGTH}-digit code to confirm it is really you asking, and we will start `}
                    {`building your copy. ${deadlineLabel(request.due_at)}.`}
                  </p>
                  <Button
                    size="sm" className="text-xs" data-testid="open-code"
                    onClick={() => setCodeOpen(true)}
                  >
                    Enter code
                  </Button>
                </div>
                <Dialog open={codeOpen} onOpenChange={setCodeOpen}>
                  <DialogContent className="sm:max-w-xs">
                    <CodeStep
                      request={request} code={code} busy={busy} now={now} error={error}
                      onCode={setCode} onConfirm={confirm} onResend={ask}
                    />
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              <div className="space-y-3">
                {step === 'asked' && request && (
                  // A request that exists with no code outstanding: one an
                  // admin recorded from an email, or one whose code expired
                  // before it was used. The deadline is already running, so the
                  // page says so rather than pretending this is a blank slate -
                  // and the button below sends the code that moves it on.
                  <div data-testid="asked" className="space-y-1">
                    <p className="text-sm font-medium">We have your request</p>
                    {request.note && (
                      <p data-testid="asked-note" className="text-xs text-muted-foreground">{request.note}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {`${deadlineLabel(request.due_at)}. To get your copy in the app, send yourself a `}
                      {`${CODE_LENGTH}-digit code and enter it here.`}
                    </p>
                  </div>
                )}
                {step === 'building' && request && (
                  <p data-testid="building" className="text-sm text-muted-foreground">
                    {`Your code was accepted and we are putting your copy together. ${deadlineLabel(request.due_at)}.`}
                  </p>
                )}
                {step === 'failed' && request && (
                  <div data-testid="build-failed" className="space-y-1">
                    <p className="text-sm text-destructive">We could not finish building your copy.</p>
                    {request.note && (
                      // What we recorded against the failure, in the words it
                      // was written in. A bare state with the explanation
                      // withheld is the same silence the note exists to end.
                      <p data-testid="failed-note" className="text-xs text-muted-foreground">{request.note}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Your request is still open and we still owe you an answer. {deadlineLabel(request.due_at)}.
                    </p>
                  </div>
                )}
                {(step === 'answered' || step === 'partial') && request && (
                  <Answer request={request} partial={step === 'partial'} now={now} />
                )}
                {/* There was a `step === 'none'` block here for "a request
                    staff closed by hand", from before the note was split. It
                    was unreachable in both of that step's cases: with no
                    request at all there is no note, and the only status that
                    reaches 'none' with a row is 'cancelled', which nothing in
                    any app writes to data_requests. A close from the admin
                    queue lands on 'answered', where `answer-note` shows what
                    staff said - which is where that copy really lives now. */}
                <div className="space-y-1.5">
                  <Button
                    data-testid="request-copy" size="sm" className="text-xs"
                    variant={step === 'answered' || step === 'partial' ? 'outline' : 'default'}
                    onClick={ask} disabled={busy || step === 'building'}
                  >
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    {askLabel}
                  </Button>
                  {request?.export && (
                    // Not a cooldown, and never worded as one: asking again is
                    // always allowed. Inside the hour the server simply hands
                    // back the copy it has rather than walking the account twice.
                    <p data-testid="ask-again-note" className="text-xs text-muted-foreground">
                      Ask again as often as you like. Within an hour of the last one we hand you this same copy rather
                      than building another.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {others.length > 0 && (
            // Named, not hidden, and given no button. Four of the five rights
            // are asked for by email and answered by a person, so there is
            // nothing here for the app to drive - but a deadline is running and
            // the person is entitled to see it. Asking for a copy while one of
            // these is open stays allowed above: they are different rights.
            <div className="py-4 space-y-2" data-testid="other-requests">
              <p className="text-sm font-medium">Your other requests</p>
              <ul className="space-y-2">
                {others.map((other) => (
                  <li key={other.id} data-testid="other-request" data-kind={other.kind} className="space-y-0.5">
                    <p className="text-sm text-muted-foreground">{describeOtherRequest(other, now())}</p>
                    {other.note && (
                      <p data-testid="other-request-note" className="text-xs text-muted-foreground">{other.note}</p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                These are answered by a person rather than in the app. Write to{' '}
                <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">{PRIVACY_EMAIL}</a>{' '}
                if you need to add anything to one.
              </p>
            </div>
          )}

          <div className="py-4">
            {/* Five paragraphs of statute used to sit under the one control
                anybody came here to press. The row names the rights so they are
                still findable at a glance - a right that is hard to find is a
                right that is hindered (Article 12) - and the reading happens in
                the dialog, where there is room to lay it out properly. */}
            <button
              type="button" data-testid="open-rights" onClick={() => setRightsOpen(true)}
              className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">Your rights</span>
                <span className="block text-xs text-muted-foreground">
                  Access, portability, erasure, restriction, objection
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <RightsDialog open={rightsOpen} onOpenChange={setRightsOpen} />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ── Steps ──────────────────────────────────────────────────

/**
 * The code entry, as the contents of a dialog.
 *
 * Narrow and centred, and deliberately nothing like the rights grid next door:
 * one thing to do, one column, one primary button the width of the box. The
 * mock drew six digit boxes; this stays a single mono input with wide tracking,
 * which reads the same and does not bring per-digit focus management, paste
 * splitting and backspace-across-boxes with it. `autoComplete="one-time-code"`
 * is the part of that mock worth having: it lets a phone offer the code
 * straight from the email or SMS.
 */
function CodeStep({
  request, code, busy, now, error, onCode, onConfirm, onResend,
}: {
  request: RequestState; code: string; busy: boolean; now: () => number; error: ErrorCopy | null;
  onCode: (v: string) => void; onConfirm: () => void; onResend: () => void;
}) {
  const wait = cooldownLabel(request.retry_at, now());
  return (
    <div data-testid="code-step" className="space-y-3 text-center">
      <div className="mx-auto flex size-9 items-center justify-center rounded-lg bg-muted">
        <Mail className="size-4 text-muted-foreground" />
      </div>
      <DialogHeader className="gap-1.5">
        <DialogTitle>Enter your code</DialogTitle>
        <DialogDescription className="text-xs">
          We emailed you a {CODE_LENGTH}-digit code to confirm it is really you asking.
        </DialogDescription>
      </DialogHeader>
      {request.note && (
        // Anything we have already told them about this request, on the screen
        // they are actually looking at. Staff writing a note on a request they
        // recorded from an email were promised it would be shown until we
        // answer, and this is one of the states before that happens.
        <p data-testid="code-step-note" className="text-xs text-muted-foreground">{request.note}</p>
      )}
      <Input
        value={code}
        onChange={(e) => onCode(normaliseCode(e.target.value))}
        placeholder="000000"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={`${CODE_LENGTH}-digit confirmation code`}
        className="w-full font-mono tracking-[0.4em] text-center"
        data-testid="code-input"
      />
      {/* The error belongs in here while this is what is in front of them. */}
      {error && (
        <p data-testid="privacy-error" role="alert" className="text-xs text-destructive">{error.text}</p>
      )}
      <Button
        size="sm" className="w-full text-xs" onClick={onConfirm}
        disabled={!isCompleteCode(code) || busy} data-testid="confirm-code"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Confirm
      </Button>
      <p className="text-xs text-muted-foreground">
        Your request is already recorded:{' '}
        <span data-testid="deadline">{deadlineLabel(request.due_at)}</span>.
      </p>
      <Button
        size="sm" variant="ghost" className="w-full text-xs" onClick={onResend}
        disabled={wait !== null || busy} data-testid="resend-code"
      >
        {wait ? `Resend ${wait}` : 'Resend code'}
      </Button>
    </div>
  );
}

/**
 * The five rights, as a reference grid rather than a page-lengthening list.
 *
 * Two columns, tight cells, no scrolling: this is something people come to look
 * up, and a right you have to scroll for is one you may not find. The
 * rectification footnote gets the dashed cell because it is a ROUTE rather than
 * a sixth entitlement - the set is five, and a filled cell would have made it
 * six. One column below `sm`, where two would be two words wide.
 */
function RightsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="rights-dialog">
        <DialogHeader>
          <DialogTitle>Your rights</DialogTitle>
          <DialogDescription className="text-xs">
            What you can ask us for, and how to ask for it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {RIGHTS.map((right) => (
            <div key={right.id} data-testid="right" data-right={right.id} className="rounded-lg bg-muted p-2.5">
              <p className="text-xs font-semibold">{right.label}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground mt-0.5">{right.body}</p>
            </div>
          ))}
          <div className="rounded-lg border border-dashed p-2.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Your name, email address, language and appearance are yours to correct at the top of this page
              (rectification); for anything you cannot change there - a billing detail, say - write to{' '}
              <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">{PRIVACY_EMAIL}</a> and we
              will correct it. And you do not have to come to us first: complaining to your own data protection
              authority instead is your right and costs you nothing.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A request we have answered, in full or in part.
 *
 * Two things, deliberately separated. The RECORD - asked when, answered when,
 * against which deadline - is the proof that we answered, and it outlives
 * everything else here. The DOWNLOADS are files we keep for 7 days against a
 * request that stays open for 30, so for most of a request's life there is a
 * record and nothing to download. Gating the record on the download meant that
 * from day 8 somebody who had exercised the right saw a page that had
 * forgotten they ever did - in exactly the window where they no longer hold
 * the copy to prove it themselves.
 */
function Answer({ request, partial, now }: { request: RequestState; partial: boolean; now: () => number }) {
  const summary = request.export;
  const at = now();
  const parts = summary ? partUrls(API_BASE, summary) : [];

  return (
    <div data-testid="answer" className="space-y-3">
      {/* One string, not a run of sibling text nodes: Chrome's page translation
          detaches text nodes, and React then removing one it had already moved
          takes the whole page down with it (see the note in profile.tsx). */}
      <p data-testid="answer-strip" className="text-xs text-muted-foreground">
        {[
          describeAnswer(request, at),
          partial ? '' : `. Our deadline was ${dueDateLabel(request.due_at)}`,
          summary ? `. These downloads expire ${expiresLabel(summary.expires_at, at)}.` : '.',
        ].join('')}
      </p>

      {partial && (
        // The row is still OPEN, and the note is the only place that says what
        // is missing. Shown verbatim rather than paraphrased: whoever wrote it -
        // the truncating build, or a person in the admin queue - was writing to
        // the reader of this page.
        <div
          data-testid="partial-notice"
          className="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-1"
        >
          <p className="text-sm font-medium text-warning">Part of your answer is still owed</p>
          <p className="text-xs text-warning">{request.note}</p>
          <p className="text-xs text-warning">
            {summary
              ? 'Your report below is complete, and the report is the legal answer. The rest of your files are being '
                + 'put together by hand; we will come back to you, and your request stays open until we do. '
                + `${deadlineLabel(request.due_at)}.`
              : 'The report we delivered was complete, and the report is the legal answer - but it has since expired, '
                + 'so there is nothing left here to download. Ask again for a fresh copy. The rest of your files are '
                + 'still owed either way, and your request stays open until they reach you. '
                + `${deadlineLabel(request.due_at)}.`}
          </p>
        </div>
      )}

      {!partial && request.note && (
        // What we told them about this answer. Shown on an answered request as
        // well as a partial one: a request finished out of band by staff is
        // exactly the case where the state alone says nothing useful, and since
        // a full answer now REPLACES the person-facing note rather than keeping
        // it, there is no stale sentence left to show.
        <p data-testid="answer-note" className="text-sm text-muted-foreground">{request.note}</p>
      )}

      {/* Three cases, not two. `summary` being null covers both a copy that
          expired and an answer that never had one, and asserting a 7-day
          retention policy at somebody whose objection was handled by a person
          describes a file that never existed. `had_export` is what the row
          itself knows. */}
      {!summary && !partial && request.had_export && (
        <p data-testid="download-expired" className="text-sm text-muted-foreground">
          {'The downloads from that answer have expired - we keep a copy for 7 days and then delete it, so it is not '
            + 'sitting on our servers waiting to leak. Nothing above is undone by that: the answer was given on the '
            + 'date shown. Ask again for a fresh copy whenever you want one.'}
        </p>
      )}

      {!summary && !partial && !request.had_export && (
        <p data-testid="answered-by-hand" className="text-sm text-muted-foreground">
          {'This one was answered by a person rather than by a download, so there is no file here. The record above '
            + 'is the answer. If you want a copy of your data as a file, ask again and we will build you one.'}
        </p>
      )}

      {summary && (
        <>
          {/* The report first: it is the answer. The archives are a convenience. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Your report</p>
                <p className="text-xs text-muted-foreground">
                  Open <span className="font-mono">start-here.html</span> inside it. Includes{' '}
                  <a
                    href={manifestUrl(API_BASE, summary.id)} data-testid="download-manifest"
                    className="underline underline-offset-2"
                  >
                    the machine-readable manifest
                  </a>{' '}
                  ({humanSize(summary.manifest_bytes)}), which you can also take on its own.
                </p>
              </div>
            </div>
            <a
              data-testid="download-report" href={reportUrl(API_BASE, summary.id)} aria-label="Download your report"
              className="inline-flex items-center gap-1 text-xs underline underline-offset-2 shrink-0"
            >
              <Download className="size-3.5" /> Download report
            </a>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Package className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Your files</p>
                <p className="text-xs text-muted-foreground">{describeArchives(summary)}</p>
              </div>
            </div>
            {summary.parts.length > 0 && (
              <ul className="space-y-1.5">
                {summary.parts.map((p, i) => (
                  <li key={p.part} data-testid="archive-part" className="flex items-center justify-between text-sm">
                    <span className="truncate">
                      {p.workspace_name}: <span className="font-mono text-xs">{p.filename}</span>
                      <span className="text-muted-foreground text-xs">
                        {' '}({p.file_count.toLocaleString('en-US')} files, {humanSize(p.bytes)})
                      </span>
                    </span>
                    <a
                      href={parts[i]} aria-label={`Download ${p.filename}`}
                      className="inline-flex items-center gap-1 text-xs underline underline-offset-2 shrink-0 ml-3"
                    >
                      <Download className="size-3.5" /> Download
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p data-testid="archives-excluded" className="text-xs text-muted-foreground">
              The archives hold the files you uploaded, in every workspace you belong to. Files uploaded by other
              people are not included, even in workspaces you own: those are their data, not yours, and handing them
              over would take their privacy to answer yours. Also left out: end-to-end encrypted Spaces, which we
              cannot read, files in the trash, and previous versions.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

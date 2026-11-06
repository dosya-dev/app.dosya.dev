import { formatNumberWith } from '@/lib/format-locale';
import { Fragment, useCallback, useEffect, useState } from 'react';
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
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';
import type { T } from '@/i18n/translator';
import { CODE_LENGTH, isCompleteCode, normaliseCode } from '@/lib/account-deletion';
import {
  answerState, cooldownLabel, deadlineLabel, describeAnswer, describeArchives, describeOtherRequest,
  dueDateLabel, errorCopy, expiresLabel, manifestUrl, partUrls, reportUrl,
  type DataState, type ErrorCopy, type RequestState,
} from '@/lib/data-rights';

const nowSeconds = () => Math.floor(Date.now() / 1000);

const PRIVACY_EMAIL = 'privacy@dosya.dev';

/** Wraps each occurrence of `token` in the translated `message` in a monospace span. */
function monoToken(message: string, token: string): React.ReactNode {
  const parts = message.split(token);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <span className="font-mono text-[11px]">{token}</span>}
      {part}
    </Fragment>
  ));
}

const mailLink = (
  <a href={`mailto:${PRIVACY_EMAIL}`} className="underline underline-offset-2">{PRIVACY_EMAIL}</a>
);

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
// Labels and bodies are catalog keys, translated at render (the page may switch language).
const RIGHTS: { id: string; labelKey: MessageKey; body: (t: T) => React.ReactNode }[] = [
  {
    id: 'access',
    labelKey: 'profile.label.seeWhatWeHoldAccess',
    body: (t) => t('profile.description.getACopyOfYourDataAtTheTopOfThis'),
  },
  {
    id: 'portability',
    labelKey: 'profile.label.takeItElsewherePortability',
    body: (t) => monoToken(t('profile.description.theReportCarriesAccountfileAndCsvFiles', { accountFile: 'account.json' }), 'account.json'),
  },
  {
    id: 'erasure',
    labelKey: 'profile.label.haveItDeletedErasure',
    body: (t) => richText(t('profile.error.deletingYourAccountDeletesYourProfileYourSessionsAndTheFiles', { link1: '{link1}' }), {
      link1: <Link to="/profile/delete" className="underline underline-offset-2">{t('profile.action.deleteAccount')}</Link>,
    }),
  },
  {
    id: 'restriction',
    labelKey: 'profile.label.askUsToPauseRestriction',
    body: (t) => richText(t('profile.description.ifYouThinkWhatWeHoldIsWrongOrYouHave', { link1: '{link1}' }), { link1: mailLink }),
  },
  {
    id: 'objection',
    labelKey: 'profile.label.tellUsToStopObjection',
    body: (t) => richText(t('profile.description.youCanObjectToAnythingWeDoOnTheBasisOf', { link1: '{link1}' }), { link1: mailLink }),
  },
];

export function PrivacySection({ now = nowSeconds }: { now?: () => number }) {
  const t = useT();
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
      setError({ text: t('profile.error.couldNotLoadYourDataRequestsReloadToTryAgain'), retryAt: null });
      setState({ ok: false, request: null });
      return null;
    }
  }, [t]);
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

  const askLabel = step === 'failed' ? t('profile.label.tryAgain')
    : step === 'answered' || step === 'partial' ? t('profile.label.askAgain')
      // Already recorded, no live code: the one thing left to do is get one
      // sent, and "Request it" would read as though nothing had been asked.
      : step === 'asked' ? t('profile.label.sendMeACode')
        : t('profile.label.requestIt');

  return (
    <section id="section-privacy">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.privacyAndYourData')}</h2>
      <Card>
        <CardContent className="divide-y">
          <div className="py-4 space-y-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('profile.label.getACopyOfYourData')}</p>
                <p className="text-sm text-muted-foreground">
                  {t('profile.description.aReadableReportOfEverythingWeHoldAboutYouWhat', { CODE_LENGTH })}
                </p>
              </div>
            </div>

            {/* One alert, never two: while the code dialog is up it renders the
                error itself, because an alert behind a modal is an alert nobody
                reads and a wrong code is exactly the moment it matters. */}
            {error && !codeOpen && (
              <p dir="auto" data-testid="privacy-error" role="alert" className="text-xs text-destructive">{error.text}</p>
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
                  <p className="text-sm font-medium text-warning">{t('profile.label.weEmailedYouACode')}</p>
                  {request.note && (
                    // The same note the dialog shows. Staff were promised the
                    // person sees what they wrote before we answer, and a note
                    // reachable only behind a dialog they may never open is not
                    // that promise kept.
                    <p data-testid="code-pending-note" className="text-xs text-warning">{request.note}</p>
                  )}
                  <p className="text-xs text-warning">
                    {t('profile.description.enterTheCodeLengthDigitCodeToConfirmItIsReallyYouAsking', { CODE_LENGTH, requestDue_at: deadlineLabel(request.due_at) })}
                  </p>
                  <Button
                    size="sm" className="text-xs" data-testid="open-code"
                    onClick={() => setCodeOpen(true)}
                  >
                    {t('profile.action.enterCode')}
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
                    <p className="text-sm font-medium">{t('profile.label.weHaveYourRequest')}</p>
                    {request.note && (
                      <p data-testid="asked-note" className="text-xs text-muted-foreground">{request.note}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('profile.description.requestdueAtToGetYourCopyInTheAppSendYourselfA', { requestDue_at: deadlineLabel(request.due_at), CODE_LENGTH })}
                    </p>
                  </div>
                )}
                {step === 'building' && request && (
                  <p data-testid="building" className="text-sm text-muted-foreground">
                    {t('profile.description.yourCodeWasAcceptedAndWeArePuttingYourCopyTogether', { requestDue_at: deadlineLabel(request.due_at) })}
                  </p>
                )}
                {step === 'failed' && request && (
                  <div data-testid="build-failed" className="space-y-1">
                    <p className="text-sm text-destructive">{t('profile.error.weCouldNotFinishBuildingYourCopy')}</p>
                    {request.note && (
                      // What we recorded against the failure, in the words it
                      // was written in. A bare state with the explanation
                      // withheld is the same silence the note exists to end.
                      <p data-testid="failed-note" className="text-xs text-muted-foreground">{request.note}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('profile.description.yourRequestIsStillOpenAndWeStillOweYouAn', { requestDue_at: deadlineLabel(request.due_at) })}
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
                      {t('profile.description.askAgainAsOftenAsYouLikeWithinAnHourOf')}
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
              <p className="text-sm font-medium">{t('profile.label.yourOtherRequests')}</p>
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
                {richText(t('profile.description.theseAreAnsweredByAPersonRatherThanInTheApp', { link1: '{link1}' }), { link1: mailLink })}
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
              className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-start transition-colors hover:bg-muted/50"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{t('profile.action.yourRights')}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('profile.action.accessPortabilityErasureRestrictionObjection')}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
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
  const t = useT();
  const wait = cooldownLabel(request.retry_at, now());
  return (
    <div data-testid="code-step" className="space-y-3 text-center">
      <div className="mx-auto flex size-9 items-center justify-center rounded-lg bg-muted">
        <Mail className="size-4 text-muted-foreground" />
      </div>
      <DialogHeader className="gap-1.5">
        <DialogTitle>{t('profile.heading.enterYourCode')}</DialogTitle>
        <DialogDescription className="text-xs">
          {t('profile.description.weEmailedYouACodeLengthDigitCodeToConfirmItIsReally', { CODE_LENGTH })}
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
        aria-label={t('profile.accessibility.codeLengthDigitConfirmationCode', { CODE_LENGTH })}
        className="w-full font-mono tracking-[0.4em] text-center"
        data-testid="code-input"
      />
      {/* The error belongs in here while this is what is in front of them. */}
      {error && (
        <p dir="auto" data-testid="privacy-error" role="alert" className="text-xs text-destructive">{error.text}</p>
      )}
      <Button
        size="sm" className="w-full text-xs" onClick={onConfirm}
        disabled={!isCompleteCode(code) || busy} data-testid="confirm-code"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {t('profile.action.confirm')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {richText(t('profile.description.yourRequestIsAlreadyRecordedRequestdueAt', { requestDue_at: '{requestDue_at}' }), {
          requestDue_at: <span data-testid="deadline">{deadlineLabel(request.due_at)}</span>,
        })}
      </p>
      <Button
        size="sm" variant="ghost" className="w-full text-xs" onClick={onResend}
        disabled={wait !== null || busy} data-testid="resend-code"
      >
        {wait ? t('profile.action.resendWait', { wait }) : t('common.action.resendCode')}
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
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="rights-dialog">
        <DialogHeader>
          <DialogTitle>{t('profile.heading.yourRights')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('profile.description.whatYouCanAskUsForAndHowToAskFor')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {RIGHTS.map((right) => (
            <div key={right.id} data-testid="right" data-right={right.id} className="rounded-lg bg-muted p-2.5">
              <p className="text-xs font-semibold">{t(right.labelKey)}</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground mt-0.5">{right.body(t)}</p>
            </div>
          ))}
          <div className="rounded-lg border border-dashed p-2.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {richText(t('profile.error.yourNameEmailAddressLanguageAndAppearanceAreYoursToCorrect', { link1: '{link1}' }), { link1: mailLink })}
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
  const t = useT();
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
          `${describeAnswer(request, at)}.`,
          partial ? '' : t('profile.description.ourDeadlineWasDate', { date: dueDateLabel(request.due_at) }),
          summary ? t('profile.description.theseDownloadsExpireWhen', { when: expiresLabel(summary.expires_at, at) }) : '',
        ].filter(Boolean).join(' ')}
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
          <p className="text-sm font-medium text-warning">{t('profile.description.partOfYourAnswerIsStillOwed')}</p>
          <p className="text-xs text-warning">{request.note}</p>
          <p className="text-xs text-warning">
            {summary
              ? t('profile.description.yourReportBelowIsCompleteAndTheReportIsTheLegal', { requestDue_at: deadlineLabel(request.due_at) })
              : t('profile.description.theReportWeDeliveredWasCompleteAndTheReportIsThe', { requestDue_at: deadlineLabel(request.due_at) })}
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
          {t('profile.description.theDownloadsFromThatAnswerHaveExpiredWeKeepA')}
        </p>
      )}

      {!summary && !partial && !request.had_export && (
        <p data-testid="answered-by-hand" className="text-sm text-muted-foreground">
          {t('profile.description.thisOneWasAnsweredByAPersonRatherThanByA')}
        </p>
      )}

      {summary && (
        <>
          {/* The report first: it is the answer. The archives are a convenience. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('profile.label.yourReport')}</p>
                <p className="text-xs text-muted-foreground">
                  {richText(
                    t('profile.description.openStartherefileInsideItIncludesLink1', {
                      startHereFile: '{startHereFile}', link1: '{link1}', summaryManifest_bytes: humanSize(summary.manifest_bytes),
                    }),
                    {
                      startHereFile: <span className="font-mono text-[11px]">start-here.html</span>,
                      link1: (
                        <a
                          href={manifestUrl(API_BASE, summary.id)} data-testid="download-manifest"
                          className="underline underline-offset-2"
                        >
                          {t('profile.action.theMachineReadableManifest')}
                        </a>
                      ),
                    },
                  )}
                </p>
              </div>
            </div>
            <a
              data-testid="download-report" href={reportUrl(API_BASE, summary.id)} aria-label={t('profile.action.downloadYourReport')}
              className="inline-flex items-center gap-1 text-xs underline underline-offset-2 shrink-0"
            >
              <Download className="size-3.5" /> {t('profile.action.downloadReport')}
            </a>
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Package className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{t('profile.label.yourFiles')}</p>
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
                        {' '}{t('profile.label.fileCounttolocalestringFilesPbytes', { file_countToLocaleString: formatNumberWith(p.file_count, undefined, 'en-US'), pBytes: humanSize(p.bytes) })}
                      </span>
                    </span>
                    <a
                      href={parts[i]} aria-label={t('profile.action.downloadPfilename', { pFilename: p.filename })}
                      className="inline-flex items-center gap-1 text-xs underline underline-offset-2 shrink-0 ms-3"
                    >
                      <Download className="size-3.5" /> {t('common.action.download')}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p data-testid="archives-excluded" className="text-xs text-muted-foreground">
              {t('profile.error.theArchivesHoldTheFilesYouUploadedInEveryWorkspaceYou')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

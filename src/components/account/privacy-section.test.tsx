import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => apiMock(...args) };
});

const { PrivacySection } = await import('./privacy-section');
const { ApiError } = await import('@/api/client');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

const ASKED = 1_790_672_400;          // 29 September 2026, 09:00 UTC
const DUE = ASKED + 30 * 86400;       // 29 October 2026
const NOW = ASKED + 600;

const EXPORT = {
  id: 'exp_1', created_at: ASKED + 240, expires_at: ASKED + 7 * 86400,
  workspace_count: 1, file_count: 3, total_bytes: 3000, part_count: 2, manifest_bytes: 100,
  parts: [
    { part: 1, workspace_id: 'ws_1', workspace_name: 'Acme', filename: 'dosya-export-acme-part-1-of-2.zip', file_count: 2, bytes: 2000 },
    { part: 2, workspace_id: 'ws_1', workspace_name: 'Acme', filename: 'dosya-export-acme-part-2-of-2.zip', file_count: 1, bytes: 1000 },
  ],
};

const NONE = { ok: true, request: null };
// retry_at null by default: `now` is frozen in these tests, so a live cooldown
// starts a 1-second interval that can never see itself expire and would go on
// ticking past the assertions. Only the cooldown test asks for one.
const PENDING = {
  ok: true,
  request: {
    id: 'drq_1', kind: 'access', status: 'pending', requested_at: ASKED, due_at: DUE,
    verified_at: null, answered_at: null, retry_at: null as number | null, note: null,
    export: null, had_export: false,
    // A code really was emailed for this one: 'pending' alone does not imply
    // that, and a request an admin recorded from an email is the counter-case.
    code_pending: true,
  },
};
const COOLING = { ok: true, request: { ...PENDING.request, retry_at: NOW + 43 } };
const ANSWERED = {
  ok: true,
  request: {
    id: 'drq_1', kind: 'access', status: 'answered', requested_at: ASKED, due_at: DUE,
    verified_at: ASKED + 120, answered_at: ASKED + 240, retry_at: null, note: null,
    export: EXPORT, had_export: true, code_pending: false,
  },
};
/**
 * A sample, deliberately NOT a copy of the sentence apps/api writes.
 *
 * This page renders whatever the API sends, word for word - that is the whole
 * contract - so a second copy of the production wording here pins nothing and
 * only creates something to drift. It already had: the copy in this file had
 * lost a clause the API's constant still carried, and no test could fail for
 * it. The API's own tests are where that wording is pinned; what these assert
 * is that the string arrives on screen unaltered.
 */
const SAMPLE_PARTIAL_NOTE = 'SAMPLE: the archives were cut short and the rest of your files are still owed.';
const PARTIAL = {
  ok: true,
  request: {
    ...ANSWERED.request, status: 'verified', answered_at: null, note: SAMPLE_PARTIAL_NOTE,
  },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<MemoryRouter><PrivacySection now={() => NOW} /></MemoryRouter>); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}
// Scoped to the document, not to `container`: two of this section's surfaces -
// the rights grid and the code entry - now live in a Dialog, and Base UI
// portals a Dialog's popup to document.body. A container-scoped query would
// report a dialog that is plainly on screen as absent. Only one component is
// mounted at a time, and `container` is inside document.body, so nothing else
// can answer these selectors.
const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[];
/** Runs of whitespace collapsed, so a sentence assembled from text, nested
 *  elements and {' '} separators can be asserted on as the sentence it reads as. */
const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim();
const click = async (sel: string) => {
  await act(async () => { (q(sel) as HTMLButtonElement).click(); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};
/** Opens the code dialog the way a person does: from the row on the page. */
const openCode = () => click('[data-testid="open-code"]');
/** Opens the rights dialog from its row. */
const openRights = () => click('[data-testid="open-rights"]');
/** Dismisses whatever dialog is up, via its own close control. */
const dismissDialog = () => click('[data-slot="dialog-content"] [data-slot="dialog-close"]');
const type = async (sel: string, value: string) => {
  const input = q(sel) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  apiMock.mockReset();
  vi.restoreAllMocks();
});

describe('PrivacySection', () => {
  it('lists the five rights with erasure linking to delete account', async () => {
    apiMock.mockResolvedValueOnce(NONE);
    await render();
    // The page itself only carries the row; the five are in the dialog.
    expect(all('[data-testid="right"]')).toHaveLength(0);
    const row = text(q('[data-testid="open-rights"]')!);
    expect(row).toContain('Your rights');
    // The five named on the row, so the set is still findable without opening
    // anything - Article 12 is about rights being easy to exercise, and a
    // rights page that hides what the rights ARE is a step backwards.
    expect(row).toContain('Access, portability, erasure, restriction, objection');
    await openRights();
    const rights = all('[data-testid="right"]');
    expect(rights.map((r) => r.dataset.right))
      .toEqual(['access', 'portability', 'erasure', 'restriction', 'objection']);
    const erasure = rights[2];
    const erasureLink = erasure.querySelector('a[href="/profile/delete"]') as HTMLAnchorElement;
    expect(erasureLink.textContent).toContain('Delete account');
    const erasureText = text(erasure);
    // The product's own Article 15 disclosure says the audit trail, billing
    // records and other people's workspaces survive a deletion. A rights page
    // promising otherwise puts two screens of one product in disagreement.
    expect(erasureText).toContain('audit trail');
    expect(erasureText).toContain('billing records');
    expect(erasureText).toContain("someone else's workspace");
  });

  it('gives rectification a route for what the profile form cannot change', async () => {
    apiMock.mockResolvedValueOnce(NONE);
    await render();
    // Restriction and objection both hand over an address; rectification used
    // to offer only "edit it above", which is no route at all for a billing
    // detail. The product's own disclosure says to write to us.
    await openRights();
    // Last cell of the grid, deliberately: rectification is a route rather than
    // a sixth right, so it reads as the footnote it is.
    const closing = all('[data-testid="rights-dialog"] a[href="mailto:privacy@dosya.dev"]').pop()!;
    const closingText = text(closing.closest('p')!);
    expect(closingText).toContain('anything you cannot change there');
    expect(closingText).toContain('and we will correct it');
  });

  it('requests, then shows the code step with the deadline', async () => {
    apiMock.mockResolvedValueOnce(NONE);
    await render();
    expect(q('[data-testid="code-step"]')).toBeNull();

    apiMock.mockResolvedValueOnce({ ok: true, request: { id: 'drq_1', due_at: DUE } });
    apiMock.mockResolvedValueOnce(PENDING);
    await click('[data-testid="request-copy"]');

    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/me/data/request', { method: 'POST' });
    // Asking is what earns the dialog: the click is the consent to be
    // interrupted, so the code box is already in front of them.
    expect(q('[data-testid="code-step"]')).not.toBeNull();
    expect(q('[data-testid="deadline"]')!.textContent).toBe('We must answer by 29 October 2026');
  });

  /**
   * The rule this section was redesigned around, and the one it would be
   * easiest to lose: a code already outstanding when the page loads must not
   * throw a dialog at somebody who came here to change their avatar. More
   * importantly, a dialog they dismiss must never be the only way to finish -
   * a statutory deadline is running and a dismissal must cost a click, not the
   * whole flow.
   */
  it('does not open the code dialog on arrival, and keeps the way in on the page', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();

    expect(q('[data-testid="code-step"]')).toBeNull();
    expect(q('[data-testid="code-input"]')).toBeNull();
    expect(q('[data-slot="dialog-content"]')).toBeNull();
    // ...and the row that says what is outstanding, with the button that opens it.
    expect(text(q('[data-testid="code-pending"]')!)).toContain('We emailed you a code');
    expect(text(q('[data-testid="code-pending"]')!)).toContain('We must answer by 29 October 2026');
    expect((q('[data-testid="open-code"]') as HTMLButtonElement).textContent).toContain('Enter code');
  });

  it('opens the code dialog from the row button', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    await openCode();
    expect(q('[data-testid="code-step"]')).not.toBeNull();
    expect(q('[data-testid="code-input"]')).not.toBeNull();
  });

  it('offers the emailed code to the browser autofill', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    await openCode();
    // One input, not six boxes - and tagged so a phone can fill it from the email.
    expect(all('[data-testid="code-input"]')).toHaveLength(1);
    expect(q('[data-testid="code-input"]')!.getAttribute('autocomplete')).toBe('one-time-code');
  });

  it('closes the code dialog once the code is verified', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    await openCode();
    await type('[data-testid="code-input"]', '123456');

    apiMock.mockResolvedValueOnce({ ok: true });
    apiMock.mockResolvedValueOnce({
      ok: true, request: { ...PENDING.request, status: 'verified', verified_at: ASKED + 120, code_pending: false },
    });
    await click('[data-testid="confirm-code"]');

    expect(q('[data-testid="code-step"]')).toBeNull();
    expect(q('[data-testid="code-input"]')).toBeNull();
    expect(text(q('[data-testid="building"]')!)).toContain('putting your copy together');
  });

  it('leaves the row and its button in place when the code dialog is dismissed', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    await openCode();
    expect(q('[data-testid="code-step"]')).not.toBeNull();

    await dismissDialog();

    // Nothing was verified, so the request is exactly where it was - and the
    // page still says so, with the door back in.
    expect(text(q('[data-testid="code-pending"]')!)).toContain('We emailed you a code');
    expect(q('[data-testid="open-code"]')).not.toBeNull();
    // And it really reopens, rather than being a button over a dead dialog.
    await openCode();
    expect(q('[data-testid="code-input"]')).not.toBeNull();
  });

  it('shows the resend cooldown and disables resend inside it', async () => {
    // Fake timers so the live countdown cannot tick outside act() while the
    // assertions run, and so the interval dies with the test rather than the file.
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      apiMock.mockResolvedValueOnce(COOLING);
      await render();
      await openCode();
      const resend = q('[data-testid="resend-code"]') as HTMLButtonElement;
      expect(resend.disabled).toBe(true);
      expect(resend.textContent).toContain('Resend in 43 seconds');
      act(() => root!.unmount()); container!.remove(); root = null;
    } finally { vi.useRealTimers(); }

    apiMock.mockResolvedValueOnce({ ...PENDING, request: { ...PENDING.request, retry_at: NOW - 1 } });
    await render();
    await openCode();
    const live = q('[data-testid="resend-code"]') as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    expect(live.textContent).toContain('Resend code');
  });

  it('keeps the typed code when a resend is refused, because nothing was burned', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    await openCode();
    await type('[data-testid="code-input"]', '123456');

    // The server burns the outstanding code only when it ACCEPTS the resend.
    // Refused inside the 60 seconds, the digits in the box are still live.
    apiMock.mockRejectedValueOnce(new ApiError(429, JSON.stringify({
      ok: false, error: 'A code was just sent. Check your inbox, or wait a minute to request another.',
      retry_at: NOW + 40,
    })));
    await click('[data-testid="resend-code"]');
    expect((q('[data-testid="code-input"]') as HTMLInputElement).value).toBe('123456');
    expect(text(q('[data-testid="privacy-error"]')!)).toContain('A code was just sent');

    // Accepted, and the old digits really are dead: the box clears.
    apiMock.mockResolvedValueOnce({ ok: true, request: { id: 'drq_1', due_at: DUE } });
    apiMock.mockResolvedValueOnce(PENDING);
    await click('[data-testid="resend-code"]');
    expect((q('[data-testid="code-input"]') as HTMLInputElement).value).toBe('');
  });

  it('rejects a wrong code without leaving the code step', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    await openCode();
    await type('[data-testid="code-input"]', '000000');

    apiMock.mockRejectedValueOnce(new ApiError(400, JSON.stringify({ ok: false, error: 'That code is not correct.' })));
    await click('[data-testid="confirm-code"]');

    expect(apiMock).toHaveBeenLastCalledWith('/api/me/data/verify', {
      method: 'POST', body: JSON.stringify({ code: '000000' }),
    });
    expect(text(q('[data-testid="privacy-error"]')!)).toContain('That code is not correct.');
    expect(q('[data-testid="code-step"]')).not.toBeNull();
  });

  it('keeps showing the code step for a reopened request that still carries verified_at', async () => {
    // The server invalidated the old code and mailed a new one; a page that
    // read verified_at instead of status would show a ready screen here.
    apiMock.mockResolvedValueOnce({
      ok: true, request: { ...PENDING.request, verified_at: ASKED - 86400 },
    });
    await render();
    expect(q('[data-testid="code-pending"]')).not.toBeNull();
    expect(q('[data-testid="answer"]')).toBeNull();
    await openCode();
    expect(q('[data-testid="code-step"]')).not.toBeNull();
  });

  it('shows the report first and the archives second once answered', async () => {
    apiMock.mockResolvedValueOnce(ANSWERED);
    await render();
    expect(text(q('[data-testid="answer-strip"]')!)).toContain('Asked 29 September, answered in 4 minutes');

    const report = q('[data-testid="download-report"]') as HTMLAnchorElement;
    expect(report.getAttribute('href')).toBe('/api/me/export/exp_1/report');
    const parts = all('[data-testid="archive-part"]');
    expect(parts).toHaveLength(2);
    expect((parts[1].querySelector('a') as HTMLAnchorElement).getAttribute('href'))
      .toBe('/api/me/export/exp_1/parts/2');
    // The report is the legal answer; the archives are a convenience. Order on
    // the page says which is which.
    expect(report.compareDocumentPosition(parts[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains that colleagues uploads are not included', async () => {
    apiMock.mockResolvedValueOnce(ANSWERED);
    await render();
    const excluded = text(q('[data-testid="archives-excluded"]')!);
    expect(excluded).toContain('uploaded by other people');
    expect(excluded).toContain('end-to-end encrypted');
  });

  it('says what is still owed after a partial delivery, in the note own words', async () => {
    apiMock.mockResolvedValueOnce(PARTIAL);
    await render();
    const notice = text(q('[data-testid="partial-notice"]')!);
    expect(notice).toContain(SAMPLE_PARTIAL_NOTE);
    expect(notice).toContain('We must answer by 29 October 2026');
    // Not dressed up as a finished answer.
    expect(text(q('[data-testid="answer-strip"]')!)).toContain('partly answered');
    expect(q('[data-testid="download-report"]')).not.toBeNull();
  });

  it('keeps the record of an answer after the download has expired', async () => {
    // Day 8 of 30: the copy is swept, the request is still answered. The proof
    // that we answered, and when, is the thing a person has left.
    // had_export stays true: a copy WAS built for this one, and the row's own
    // export_id is what says so long after the file itself is swept.
    apiMock.mockResolvedValueOnce({ ok: true, request: { ...ANSWERED.request, export: null } });
    await render();
    expect(text(q('[data-testid="answer-strip"]')!))
      .toContain('Asked 29 September, answered in 4 minutes');
    expect(text(q('[data-testid="answer-strip"]')!)).toContain('Our deadline was 29 October 2026');
    expect(text(q('[data-testid="download-expired"]')!)).toContain('expired');
    expect(q('[data-testid="download-report"]')).toBeNull();
    expect(all('[data-testid="archive-part"]')).toHaveLength(0);
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).textContent).toContain('Ask again');
  });

  /**
   * The third case, and for two of the five rights it is the ONLY case.
   * Restriction and objection requests are always closed by a person from the
   * admin queue, which links no export - so "no download" is their permanent,
   * deterministic state. The page used to answer them with a 7-day retention
   * policy for a file that never existed.
   */
  it('does not claim a download expired when the answer never had one', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: {
        ...ANSWERED.request, kind: 'objection', export: null, had_export: false,
        note: 'We have stopped using your data for the purpose you objected to.',
      },
    });
    await render();
    expect(q('[data-testid="download-expired"]')).toBeNull();
    const byHand = text(q('[data-testid="answered-by-hand"]')!);
    expect(byHand).toContain('answered by a person');
    expect(byHand).not.toContain('7 days');
    expect(byHand).not.toContain('expired');
    // The record of the answer survives either way.
    expect(text(q('[data-testid="answer-strip"]')!)).toContain('Asked 29 September');
  });

  /**
   * Ruling 8: a request finished out of band, or one whose build failed, used
   * to show a bare state with the explanation withheld. It is safe to show now
   * because a full answer REPLACES the person-facing note rather than keeping
   * the one a partial delivery wrote, so nothing stale can reach this.
   */
  it('shows what we told them on an answered request', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: {
        ...ANSWERED.request, export: null, had_export: false,
        note: 'Your archives went out on an encrypted drive on 12 October.',
      },
    });
    await render();
    expect(text(q('[data-testid="answer-note"]')!)).toContain('encrypted drive');
  });

  it('shows what we told them about a failed build', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: {
        ...PENDING.request, status: 'failed', retry_at: null,
        note: 'We could not finish building your copy. Nothing about your request has been lost.',
      },
    });
    await render();
    expect(text(q('[data-testid="failed-note"]')!)).toContain('Nothing about your request has been lost');
  });

  it('still calls a partial delivery partial after its report expired', async () => {
    apiMock.mockResolvedValueOnce({ ok: true, request: { ...PARTIAL.request, export: null } });
    await render();
    expect(q('[data-testid="building"]')).toBeNull();
    const notice = text(q('[data-testid="partial-notice"]')!);
    expect(notice).toContain(SAMPLE_PARTIAL_NOTE);
    expect(notice).toContain('has since expired');
    expect(notice).toContain('still owed');
    expect(text(q('[data-testid="answer-strip"]')!)).toContain('partly answered');
  });

  it('says it is building only while nothing has been delivered', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true, request: { ...PENDING.request, status: 'verified', verified_at: ASKED + 120 },
    });
    await render();
    expect(text(q('[data-testid="building"]')!))
      .toBe('Your code was accepted and we are putting your copy together. We must answer by 29 October 2026.');
    expect(q('[data-testid="answer"]')).toBeNull();
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('announces an error with role=alert', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(500, JSON.stringify({ ok: false, error: 'server_error' })));
    await render();
    const err = q('[data-testid="privacy-error"]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(text(err)).toContain('Reload');
    // A failed read says nothing about whether a request can be MADE.
    expect(q('[data-testid="request-copy"]')).not.toBeNull();
  });

  /**
   * The admin dialog promises staff that a note they write is shown in the
   * person's account until we answer. A recorded request is inserted at
   * 'pending', so every state before verification has to honour that - the
   * code step included, which is where the person lands the moment they ask
   * for a copy themselves.
   */
  it('shows what staff told them on the code step too', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: { ...PENDING.request, note: 'We have your email and are working on it.' },
    });
    await render();
    // On the page first, because a note reachable only behind a dialog nobody
    // opens is not the promise staff were given.
    expect(text(q('[data-testid="code-pending-note"]')!)).toContain('working on it');
    await openCode();
    expect(q('[data-testid="code-step"]')).not.toBeNull();
    expect(text(q('[data-testid="code-step-note"]')!)).toContain('working on it');
  });

  /**
   * The one broken path left in the flow: an admin records a request for
   * somebody who has an account, that person opens the app, and the code step
   * appears for a code nobody ever sent. They wait for an email that is not
   * coming.
   */
  it('offers to send a code rather than asking for one that was never sent', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: {
        ...PENDING.request, code_pending: false,
        note: 'We have your letter and will reply by 12 October.',
      },
    });
    await render();

    expect(q('[data-testid="code-step"]')).toBeNull();
    expect(text(q('[data-testid="asked"]')!)).toContain('We must answer by 29 October 2026');
    // What staff told them, in their own words.
    expect(text(q('[data-testid="asked-note"]')!)).toContain('reply by 12 October');
    // And the button mints one, so the screen has a way out.
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).textContent).toContain('Send me a code');
  });

  it('shows the code row only while a live code is outstanding', async () => {
    apiMock.mockResolvedValueOnce(PENDING);
    await render();
    expect(q('[data-testid="code-pending"]')).not.toBeNull();
    expect(q('[data-testid="asked"]')).toBeNull();
  });

  /**
   * Replaces a test for a `closed-note` block on 'cancelled'. Nothing in any
   * app writes 'cancelled' to data_requests - a close from the admin queue
   * lands on 'answered' - so both the block and the test were describing the
   * pre-split world, where staff notes arrived through the internal column.
   * 'answered' is where a hand-closed request really goes, and `answer-note`
   * is where what staff said really shows.
   *
   * The arm itself stays in answerState: the column's CHECK and the API's own
   * DataRequestStatus both permit the value, so a switch that stopped being
   * total would return undefined for a status the schema allows.
   */
  it('offers a fresh ask for a cancelled request, whatever it carries', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: {
        ...PENDING.request, status: 'cancelled', retry_at: null, code_pending: false,
        note: 'Withdrawn at your request on 2 October.',
      },
    });
    await render();
    expect(q('[data-testid="code-step"]')).toBeNull();
    expect(q('[data-testid="asked"]')).toBeNull();
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).textContent).toContain('Request it');
  });

  it('keeps a failed build an open request and offers another go', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: {
        ...PENDING.request, status: 'failed', retry_at: null,
        note: 'We could not finish building your copy. Your request is still open.',
      },
    });
    await render();
    expect(text(q('[data-testid="build-failed"]')!)).toContain('still open');
    // A machine code is not a sentence. The note the API writes is checked in
    // apps/api; what this asserts is that whatever it says reaches the page.
    expect(text(q('[data-testid="failed-note"]')!)).toContain('could not finish');
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).textContent).toContain('Try again');
  });

  /**
   * The panel drives ONE right. An objection or an erasure that staff recorded
   * from an email used to arrive as `request` and was rendered under "Get a
   * copy of your data" with its own deadline attached - and the button beneath
   * it opened a second access request with a second statutory month.
   *
   * The API now scopes `request` to access and returns the rest separately.
   * What this page has to do with them is name them and offer no button.
   */
  it('names another open right without pretending it is the data-copy request', async () => {
    apiMock.mockResolvedValueOnce({
      ok: true,
      request: null,
      other_requests: [{
        id: 'drq_obj', kind: 'objection', status: 'pending',
        requested_at: ASKED, due_at: DUE, note: 'We have your letter and will reply.',
      }],
    });
    await render();

    const rows = all('[data-testid="other-request"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].dataset.kind).toBe('objection');
    const line = text(rows[0]);
    expect(line).toContain('We have your objection');
    expect(line).toContain('We must answer by 29 October 2026');
    expect(text(q('[data-testid="other-request-note"]')!)).toContain('will reply');

    // Not presented as a data-copy request in any of its states...
    expect(q('[data-testid="asked"]')).toBeNull();
    expect(q('[data-testid="code-step"]')).toBeNull();
    expect(q('[data-testid="answer"]')).toBeNull();
    // ...and asking for a copy is still offered, because they are different
    // rights and having one open must not block the other.
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).disabled).toBe(false);
    expect((q('[data-testid="request-copy"]') as HTMLButtonElement).textContent).toContain('Request it');
  });

  it('shows no other-requests block when there are none', async () => {
    apiMock.mockResolvedValueOnce(NONE);
    await render();
    expect(q('[data-testid="other-requests"]')).toBeNull();
  });
});

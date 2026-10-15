import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '' };
});

// logoutAndRedirect cancels in-flight uploads before leaving; the runner spawns
// real XHRs, which jsdom cannot serve.
const cancelAll = vi.fn();
vi.mock('@/lib/upload-runner', () => ({ cancelAll: () => cancelAll() }));

import { AlreadySignedInDialog } from './already-signed-in-dialog';
import type { SessionAccount } from '@/hooks/use-session-probe';
import { REDEMPTION_CLAIM_KEY } from '@/lib/redemption-claim';
import { rememberPostAuthPath } from '@/lib/post-auth-path';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const USER = {
  id: 'usr_1',
  name: 'Firat Kaya',
  email: 'firat@example.com',
  avatar_url: null,
  deletion_scheduled_for: null,
};
const SIGNED_IN: SessionAccount = { status: 'in', user: USER };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let hrefs: string[] = [];

beforeEach(() => {
  hrefs = [];
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  // jsdom refuses a real navigation; capture the assignment instead.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { set href(v: string) { hrefs.push(v); }, get href() { return hrefs.at(-1) ?? ''; } },
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  navigate.mockReset();
  cancelAll.mockReset();
  vi.unstubAllGlobals();
});

async function render(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); await Promise.resolve(); });
}

const dialog = () => document.body.querySelector('[data-slot="dialog-content"]');
const button = (text: string) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes(text));

describe('AlreadySignedInDialog', () => {
  it('renders nothing while the session probe is pending', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={{ status: 'pending', user: null }} />);
    expect(dialog()).toBeNull();
  });

  it('renders nothing when the visitor is signed out', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={{ status: 'out', user: null }} />);
    expect(dialog()).toBeNull();
  });

  it('renders nothing when the page suppresses it', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} suppressed />);
    expect(dialog()).toBeNull();
  });

  it('names the signed-in account on the continue button', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    expect(button('Continue as Firat Kaya')).toBeDefined();
    expect(dialog()!.textContent).toContain('firat@example.com');
  });

  it('falls back to the email when the account has no name', async () => {
    await render(
      <AlreadySignedInDialog purpose="login" account={{ status: 'in', user: { ...USER, name: '' } }} />,
    );
    expect(button('Continue as firat@example.com')).toBeDefined();
  });

  it('warns when the account it offers is scheduled for deletion', async () => {
    await render(
      <AlreadySignedInDialog
        purpose="login"
        account={{ status: 'in', user: { ...USER, deletion_scheduled_for: 1792800000 } }}
      />,
    );
    expect(dialog()!.textContent).toContain('scheduled for deletion');
  });

  it('says nothing about deletion for an account that is not being deleted', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    expect(dialog()!.textContent).not.toContain('scheduled for deletion');
  });

  it('sends continue to the path the interrupted flow stashed', async () => {
    rememberPostAuthPath('/connect/extension?state=abc');
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    await act(async () => { button('Continue as')!.click(); });
    expect(navigate).toHaveBeenCalledWith('/connect/extension?state=abc');
  });

  it('prefers a held redemption claim over the stashed path', async () => {
    sessionStorage.setItem(REDEMPTION_CLAIM_KEY, 'a'.repeat(40));
    rememberPostAuthPath('/files');
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    await act(async () => { button('Continue as')!.click(); });
    expect(navigate).toHaveBeenCalledWith('/redeem');
  });

  it('sends continue to the app root when no flow was interrupted', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    await act(async () => { button('Continue as')!.click(); });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('logs out and reopens the login page for a different account', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    await act(async () => { button('Log in with a different account')!.click(); });
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.some(([url, init]) => url === '/api/auth/logout' && init?.method === 'POST')).toBe(true);
    expect(cancelAll).toHaveBeenCalledTimes(1);
    expect(hrefs).toEqual(['/login']);
  });

  it('logs out and reopens the sign-up page for a second account', async () => {
    await render(<AlreadySignedInDialog purpose="signup" account={SIGNED_IN} />);
    await act(async () => { button('Create a new account')!.click(); });
    expect(hrefs).toEqual(['/sign-up']);
  });

  it('offers the sign-up visitor a way to sign in as someone else instead', async () => {
    await render(<AlreadySignedInDialog purpose="signup" account={SIGNED_IN} />);
    await act(async () => { button('Log in instead')!.click(); });
    expect(hrefs).toEqual(['/login']);
  });

  it('leaves the form behind once dismissed', async () => {
    await render(<AlreadySignedInDialog purpose="login" account={SIGNED_IN} />);
    await act(async () => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(dialog()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(hrefs).toEqual([]);
  });
});

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

// Turnstile injects a Cloudflare script and renders an iframe; irrelevant here
// and unavailable in jsdom. The handle must still expose the methods the pages
// call on submit, or the click path throws before the fetch is made.
vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

import LoginPage from './login';
import SignUpPage from './sign-up';

const TERMS_URL = 'https://dosya.dev/terms-of-service';
const PRIVACY_URL = 'https://dosya.dev/privacy-policy';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('auth pages - legal notices', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    navigate.mockClear();
    vi.unstubAllGlobals();
  });

  async function render(Page: () => React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
  }

  function links() {
    return [...container!.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  }

  it('sign-up links BOTH the Terms of Service and the Privacy Policy', async () => {
    await render(SignUpPage);
    // The privacy notice must be given at the point personal data is
    // collected, which is this form - a Terms-only link does not cover it.
    expect(links()).toContain(TERMS_URL);
    expect(links()).toContain(PRIVACY_URL);
  });

  it('login links BOTH the Terms of Service and the Privacy Policy', async () => {
    await render(LoginPage);
    expect(links()).toContain(TERMS_URL);
    expect(links()).toContain(PRIVACY_URL);
  });

  it('sign-up carries a notice covering the OAuth buttons, not just the checkbox', async () => {
    await render(SignUpPage);
    // "Continue with Google" sits ABOVE the form and creates a real account
    // without ever touching the consent checkbox. The API stamps those
    // accounts as having accepted, so the passive notice is what that stamp
    // rests on - the checkbox alone leaves the OAuth path unnoticed.
    expect(container!.textContent).toContain('By continuing, you agree to our');
  });

  it('legal links open in a new tab without leaking the referrer', async () => {
    await render(SignUpPage);
    const legal = [...container!.querySelectorAll('a')].filter((a) =>
      [TERMS_URL, PRIVACY_URL].includes(a.getAttribute('href') ?? ''),
    );
    expect(legal.length).toBeGreaterThanOrEqual(2);
    for (const a of legal) {
      // target=_blank without rel=noreferrer hands the opened page a
      // window.opener handle back into the authenticated app.
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel') ?? '').toContain('noreferrer');
    }
  });

  it('sign-up tells the API the terms were accepted', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, redirect: '/verify' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(SignUpPage);

    const set = (id: string, value: string) => {
      const el = container!.querySelector<HTMLInputElement>(`#${id}`)!;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      act(() => {
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    set('name', 'Ada Lovelace');
    set('email', 'ada@example.com');
    set('password', 'Correct-Horse-99');

    // Tick the consent checkbox, then submit. Base UI's visible root is a
    // <span role="checkbox"> that ignores a synthetic .click(); the hidden
    // native input behind it is what actually drives the state.
    act(() => {
      container!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(
      container!.querySelector('[data-slot="checkbox"]')!.getAttribute('aria-checked'),
      'consent checkbox did not tick - the rest of this test would be vacuous',
    ).toBe('true');
    await act(async () => {
      container!.querySelector<HTMLFormElement>('form')!.requestSubmit();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // The server rejects a signup without this field, so a client that never
    // sends it cannot create an account at all.
    expect(JSON.parse(init.body as string)).toMatchObject({ terms: true });
  });
});

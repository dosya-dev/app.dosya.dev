/**
 * The signed-out pages and recovery flows in Turkish: no English left on
 * sign in, sign up, two-factor, forgot/reset password, verify, redeem, family
 * join, welcome and create-workspace, and the sentences with inline links keep
 * their real links. Uses the shared sweep helper (tests/helpers).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/components/turnstile-widget', () => ({ TurnstileWidget: () => <div data-testid="turnstile" /> }));
vi.mock('@/lib/upload-runner', () => ({ cancelAll: () => {} }));
vi.mock('@/lib/logout', () => ({ logoutAndRedirect: () => {}, logoutAndRedirectTo: () => {} }));
const familyMock = vi.hoisted(() => ({ previewFamilyJoin: vi.fn(), acceptFamilyJoin: vi.fn() }));
vi.mock('@/api/family', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/family')>();
  return { ...actual, ...familyMock };
});
vi.mock('@/api/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/billing')>();
  return { ...actual, getBillingStatus: vi.fn().mockResolvedValue(null) };
});

const LoginPage = (await import('@/pages/login')).default;
const Login2faPage = (await import('@/pages/login-2fa')).default;
const SignUpPage = (await import('@/pages/sign-up')).default;
const ForgotPasswordPage = (await import('@/pages/forgot-password')).default;
const ResetPasswordPage = (await import('@/pages/reset-password')).default;
const VerifyPage = (await import('@/pages/verify')).default;
const RedeemPage = (await import('@/pages/redeem')).default;
const FamilyJoinPage = (await import('@/pages/family-join')).default;
const CreateWorkspacePage = (await import('@/pages/create-workspace')).default;
const { AlreadySignedInDialog } = await import('@/components/already-signed-in-dialog');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
  familyMock.previewFamilyJoin.mockReset();
  sessionStorage.clear();
  localStorage.clear();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement, entry = '/') {
  apiMock.mockResolvedValue({ ok: false });
  shown = await renderInLocale(<MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>, 'tr');
  await flush();
  return shown;
}
const text = () => shown!.container.textContent ?? '';
const fill = (el: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = async (form: HTMLFormElement) => {
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });
};

describe('sign in', () => {
  it('has no leftover English', async () => {
    await show(<LoginPage />, '/login');
    expect(text()).toContain(tr['common.heading.welcomeBack']);
    expect(text()).toContain(tr['common.action.continueWithGoogle']);
    expect(text()).toContain(tr['sign-in.action.forgotPassword']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('shows the OAuth failure and the reset notice in Turkish', async () => {
    await show(<LoginPage />, '/login?error=github_denied');
    expect(text()).toContain(tr['sign-in.description.providerSignInWasCancelledPleaseTryAgain'].replace('{provider}', 'GitHub'));
    shown!.unmount();
    await show(<LoginPage />, '/login?reset=1');
    expect(text()).toContain(tr['sign-in.description.yourPasswordHasBeenChangedSignInWithYourNewPassword']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('the network failure message is Turkish', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await show(<LoginPage />, '/login');
    fill(shown!.container.querySelector<HTMLInputElement>('#email')!, 'a@b.co');
    fill(shown!.container.querySelector<HTMLInputElement>('#password')!, 'secret123');
    await submit(shown!.container.querySelector('form')!);
    await flush();
    expect(text()).toContain(tr['common.error.canTReachTheServerCheckYourConnectionAnd']);
    expect(shown!.leftover()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('the sign-up sentence keeps its link', async () => {
    await show(<LoginPage />, '/login');
    const link = [...shown!.container.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/sign-up');
    expect(link?.textContent).toBe(tr['sign-in.action.signUp']);
  });
});

describe('sign up', () => {
  it('has no leftover English and the legal sentence renders real links', async () => {
    await show(<SignUpPage />, '/sign-up');
    expect(text()).toContain(tr['sign-up.heading.createAnAccount']);
    const hrefs = [...shown!.container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://dosya.dev/terms-of-service');
    expect(hrefs).toContain('https://dosya.dev/privacy-policy');
    expect(hrefs).toContain('/login');
    expect(shown!.leftover()).toEqual([]);
  });

  it('the consent error is Turkish', async () => {
    await show(<SignUpPage />, '/sign-up');
    await submit(shown!.container.querySelector('form')!);
    expect(text()).toContain(tr['sign-up.error.pleaseAcceptTheTermsOfServiceToContinue']);
    expect(shown!.leftover()).toEqual([]);
  });
});

describe('two-factor, recovery and verify', () => {
  it('two-factor has no leftover English in both modes', async () => {
    await show(<Login2faPage />, '/login/2fa');
    expect(text()).toContain(tr['common.heading.twoFactorAuthentication']);
    expect(shown!.leftover()).toEqual([]);
    await act(async () => { [...shown!.container.querySelectorAll('button')].find((b) => b.textContent === tr['two-factor.action.useARecoveryCodeInstead'])!.click(); });
    expect(text()).toContain(tr['two-factor.label.enterARecoveryCode']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('forgot password has no leftover English and keeps the back link', async () => {
    await show(<ForgotPasswordPage />, '/forgot-password');
    expect(text()).toContain(tr['forgot-password.heading.resetYourPassword']);
    expect([...shown!.container.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/login')).toBe(true);
    expect(shown!.leftover()).toEqual([]);
  });

  it('reset password links to a new request when the token is missing', async () => {
    await show(<ResetPasswordPage />, '/reset-password');
    expect(text()).toContain(tr['reset-password.action.requestANewOne']);
    expect([...shown!.container.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/forgot-password')).toBe(true);
    expect(shown!.leftover()).toEqual([]);
  });

  it('verify names the address and keeps both help links', async () => {
    await show(<VerifyPage />, '/verify?email=jane@example.com');
    expect(text()).toContain('jane@example.com');
    expect(text()).not.toContain('{');
    const hrefs = [...shown!.container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://dosya.dev/contact?topic=verification');
    expect(hrefs).toContain('/sign-up');
    expect(shown!.leftover()).toEqual([]);
  });
});

describe('verify sentence in English', () => {
  async function english(email: string) {
    apiMock.mockResolvedValue({ ok: false });
    shown = await renderInLocale(<MemoryRouter initialEntries={['/verify' + (email ? `?email=${encodeURIComponent(email)}` : '')]}><VerifyPage /></MemoryRouter>, 'en');
    await flush();
    return shown.container.querySelector('h1')!.nextElementSibling!.textContent;
  }
  it.each(['jane@example.com', "o'neil+test@example.com", 'true@example.com'])('is exactly the pre-change sentence for %s', async (email) => {
    expect(await english(email)).toBe(`Enter the 6-digit code we sent to ${email}.`);
    shown!.unmount();
  });
  it('without an address it says "to your email"', async () => {
    expect(await english('')).toBe('Enter the 6-digit code we sent to your email.');
  });
});

describe('redeem', () => {
  it('the source step has no leftover English', async () => {
    await show(<RedeemPage />, '/redeem');
    expect(text()).toContain(tr['redeem.tooltip.whereDidYouGetYourCode']);
    expect(shown!.container.querySelector('ol')!.getAttribute('aria-label')).toBe(tr['redeem.accessibility.redemptionProgress']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('the code step and its empty-code error are Turkish', async () => {
    await show(<RedeemPage />, '/redeem');
    await act(async () => { shown!.container.querySelector<HTMLElement>('[data-source="voucher"]')!.click(); });
    expect(text()).toContain(tr['redeem.heading.enterYourCouponCode']);
    expect(shown!.leftover()).toEqual([]);
    await submit(shown!.container.querySelector('form')!);
    expect(text()).toContain(tr['redeem.description.enterYourCouponCodeToContinue']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('sign-in required step has no leftover English', async () => {
    const { rememberRedemptionClaim } = await import('@/lib/redemption-claim');
    rememberRedemptionClaim('c'.repeat(40));
    const { ApiError } = await import('@/api/client');
    apiMock.mockRejectedValue(new ApiError(401, '{}'));
    shown = await renderInLocale(<MemoryRouter initialEntries={['/redeem']}><RedeemPage /></MemoryRouter>, 'tr');
    await flush();
    expect(text()).toContain(tr['redeem.tooltip.signInToContinue']);
    expect(shown.leftover()).toEqual([]);
  });
});

describe('family join', () => {
  it('the invitation preview has no leftover English', async () => {
    familyMock.previewFamilyJoin.mockResolvedValue({
      state: 'ready', payer: { name: 'Ayse' }, plan: { name: 'Family' }, pool_label: '2 TB', invited_email: 'me@example.com', block: null,
    });
    await show(<FamilyJoinPage />, '/family/join/tok');
    expect(text()).toContain('Ayse');
    expect(text()).toContain(tr['family-join.action.acceptInvitation']);
    expect(shown!.leftover()).toEqual([]);
  });

  it('the signed-out state is Turkish', async () => {
    const { ApiError } = await import('@/api/client');
    familyMock.previewFamilyJoin.mockRejectedValue(new ApiError(401, '{}'));
    await show(<FamilyJoinPage />, '/family/join/tok');
    expect(text()).toContain(tr['family-join.heading.signInToSeeThisInvitation']);
    expect(shown!.leftover()).toEqual([]);
  });
});

// components/location-picker.tsx is a shared component outside this task's files;
// its own strings are converted with the task that owns it.
const LOCATION_PICKER_TEXTS = new Set(['Search locations', 'Search a city or country', 'Location', 'No locations available.']);
const notLocationPicker = (text: string) => !LOCATION_PICKER_TEXTS.has(text);

describe('create workspace', () => {
  it('the form has no leftover English and its validation error is Turkish', async () => {
    apiMock.mockImplementation(async (path: string) =>
      path === '/api/regions' ? { ok: true, regions: [], suggested: '' } : { ok: true, workspaces: [] });
    shown = await renderInLocale(<MemoryRouter initialEntries={['/create-workspace']}><CreateWorkspacePage /></MemoryRouter>, 'tr');
    await flush();
    expect(text()).toContain(tr['create-workspace.heading.createYourWorkspace']);
    expect(shown.leftover().filter(notLocationPicker)).toEqual([]);
    await submit(shown.container.querySelector('form')!);
    expect(text()).toContain(tr['create-workspace.error.workspaceNameIsRequired']);
    expect(shown.leftover().filter(notLocationPicker)).toEqual([]);
  });
});

describe('already signed in dialog', () => {
  it.each(['login', 'signup'] as const)('the %s prompt has no leftover English', async (purpose) => {
    shown = await renderInLocale(
      <MemoryRouter>
        <AlreadySignedInDialog
          purpose={purpose}
          account={{ status: 'in', user: { id: 'u1', name: 'Firat', email: 'f@example.com', avatar_url: null, deletion_scheduled_for: null } } as never}
        />
      </MemoryRouter>, 'tr');
    await flush();
    expect(document.body.textContent).toContain(tr[purpose === 'login' ? 'common.heading.youReAlreadySignedIn' : 'common.heading.youAlreadyHaveAnAccount']);
    expect(shown.leftover()).toEqual([]);
  });
});

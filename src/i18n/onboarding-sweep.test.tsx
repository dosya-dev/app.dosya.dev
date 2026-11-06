/**
 * Onboarding, the welcome tour and the two sign-in helpers in Turkish: no
 * English left on the purpose picker, the checklist (every purpose), the
 * first-run home, the setup pill, the tour steps, the theme and referral
 * panels; the password-strength labels and the Turnstile messages translate.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderInLocale, type Rendered } from '../../tests/helpers/i18n-sweep';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/lib/upload-runner', () => ({ enqueue: () => {}, enqueueByFolder: () => 0 }));

const { PurposePicker } = await import('@/components/onboarding/purpose-picker');
const { OnboardingChecklist } = await import('@/components/onboarding/onboarding-checklist');
const { FirstRunHome } = await import('@/components/onboarding/first-run-home');
const { SetupPill } = await import('@/components/onboarding/setup-pill');
const { TourLayout } = await import('@/components/tour/tour-layout');
const { TOUR_STEPS } = await import('@/components/tour/tour-steps');
const { ThemeStep } = await import('@/components/tour/theme-step');
const { ReferralStep } = await import('@/components/tour/referral-step');
const { scorePassword } = await import('@/lib/password-strength');
const { turnstileFailureMessage } = await import('@/lib/turnstile-submit');
const { useOnboarding } = await import('@/stores/onboarding');
const { useWorkspace } = await import('@/stores/workspace');
const tr = (await import('@/i18n/messages/tr.json')).default as Record<string, string>;

let shown: Rendered | null = null;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  shown?.unmount();
  shown = null;
  apiMock.mockReset();
});

const NONE = {
  upload: false, share: false, import: false, api_key: false, client_used: false,
  invite: false, file_request: false, geo: false, desktop: false, mobile: false,
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function show(ui: React.ReactElement) {
  shown = await renderInLocale(<MemoryRouter>{ui}</MemoryRouter>, 'tr');
  await flush();
  return shown;
}

describe('onboarding in Turkish', () => {
  it('purpose picker has no leftover English', async () => {
    const r = await show(<PurposePicker onPick={() => {}} onSkip={() => {}} />);
    expect(r.container.textContent).toContain(tr['dashboard.description.whatWillYouUseDosyaFor']);
    expect(r.leftover()).toEqual([]);
  });

  for (const purpose of ['personal', 'dev', 'team', 'media', null] as const) {
    it(`checklist (${purpose ?? 'generic'}) has no leftover English`, async () => {
      const r = await show(<OnboardingChecklist purpose={purpose} steps={NONE} />);
      expect(r.container.textContent).toContain(tr['dashboard.label.getSetUp']);
      expect(r.leftover()).toEqual([]);
    });
  }

  it('first-run home has no leftover English', async () => {
    useWorkspace.setState({ activeId: 'ws_1' });
    useOnboarding.setState({ purpose: null, dismissed: false, steps: NONE, loaded: true, failed: false });
    const r = await show(<FirstRunHome userName="Jane Doe" />);
    expect(r.container.textContent).toContain(tr['dashboard.label.orClickToBrowseYourComputer']);
    expect(r.leftover()).toEqual([]);
  });

  it('setup pill has no leftover English', async () => {
    useWorkspace.setState({ activeId: 'ws_1' });
    useOnboarding.setState({
      purpose: 'dev', dismissed: false, steps: { ...NONE, upload: true }, loaded: true, failed: false,
    });
    const r = await show(<SetupPill />);
    expect(r.container.textContent).toContain(tr['common.label.setup']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('tour in Turkish', () => {
  for (const i of [0, 1, 2, 3, 4]) {
    it(`tour page ${i + 1} has no leftover English`, async () => {
      const r = await show(
        <TourLayout
          step={TOUR_STEPS[i]} index={i} total={5}
          onBack={() => {}} onNext={() => {}} onSkip={() => {}}
          preview={<div />}
        />,
      );
      expect(r.container.textContent).toContain(tr['welcome.action.skip']);
      expect(r.leftover()).toEqual([]);
    });
  }

  it('theme step has no leftover English', async () => {
    const r = await show(<ThemeStep onThemeChange={() => {}} />);
    expect(r.container.textContent).toContain(tr['welcome.label.pickATheme']);
    expect(r.leftover()).toEqual([]);
  });

  it('referral step has no leftover English', async () => {
    apiMock.mockResolvedValue({ ok: true, link: 'https://dosya.dev/r/abc' });
    const r = await show(<ReferralStep />);
    expect(r.container.textContent).toContain(tr['common.label.yourInviteLink']);
    expect(r.leftover()).toEqual([]);
  });
});

describe('sign-in helpers in Turkish', () => {
  it('password-strength labels and warnings translate', async () => {
    await show(<div />);
    expect(scorePassword('abcdefghijkl').label).toBe(tr['common.label.weak']);
    expect(scorePassword('Tr0ub4dor&3xyzQ!').label).toBe(tr['common.label.strong']);
    expect(scorePassword('aaaaaaaaaa').warning).toBe(tr['common.description.aSingleRepeatedCharacterIsTrivialToGuess']);
    expect(scorePassword('abc').warning).toContain('8');
    expect(scorePassword('abc').warning).not.toBe('Use at least 8 characters.');
  });

  it('turnstile messages translate', async () => {
    await show(<div />);
    expect(turnstileFailureMessage(null)).toBe(tr['common.description.pleaseCompleteTheVerificationChallengeAboveThenTryAgain']);
    const unavailable = { status: () => 'unavailable' } as never;
    expect(turnstileFailureMessage(unavailable)).toBe(tr['common.error.weCouldnTLoadTheVerificationChallengeIfYouUseAnAd']);
  });
});

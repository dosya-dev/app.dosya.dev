import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

// The demos are heavy and already covered by their own vendored test; the
// route's job is orchestration, so stub them to keep this test about that.
// All three are DEFAULT exports, so the factories must return `default`.
// Each stub echoes its props onto data attributes, so a test can prove what
// actually reaches the preview - not just that the demo rendered:
//  - data-theme: the chosen theme id
//  - data-show-theme-controls: whether the demo's own theme picker shows
//  - data-cta-href: the toast CTA link ("null" string when disabled)
//  - data-view (WebDemo only): which page the demo seeds to
interface DemoStubProps { theme?: string; showThemeControls?: boolean; ctaHref?: string | null; initialView?: string }
function demoStub(testid: string) {
  return (props: DemoStubProps) => (
    <div
      data-testid={testid}
      data-theme={props.theme}
      data-show-theme-controls={String(props.showThemeControls)}
      data-cta-href={props.ctaHref === null ? 'null' : props.ctaHref}
      data-view={props.initialView}
    />
  );
}
vi.mock('@/components/demo/WebDemo', () => ({ default: demoStub('web-demo') }));
vi.mock('@/components/demo/DesktopDemo', () => ({ default: demoStub('desktop-demo') }));
vi.mock('@/components/demo/MobileDemo', () => ({ default: demoStub('mobile-demo') }));

import WelcomePage from './welcome';
import { TOUR_STEPS } from '@/components/tour/tour-steps';
import { TOUR_DONE_KEY } from '@/lib/boot';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('WelcomePage', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null; container = null;
    navigate.mockClear();
    vi.unstubAllGlobals();
    sessionStorage.removeItem(TOUR_DONE_KEY);
  });

  async function render() {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter><WelcomePage /></MemoryRouter>);
      await Promise.resolve();
    });
  }

  function click(testid: string) {
    act(() => { container!.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!.click(); });
  }

  it('starts on the first page', async () => {
    await render();
    expect(container!.textContent).toContain(TOUR_STEPS[0].heading);
  });

  it('advances and goes back', async () => {
    await render();
    click('tour-next');
    expect(container!.textContent).toContain(TOUR_STEPS[1].heading);
    click('tour-back');
    expect(container!.textContent).toContain(TOUR_STEPS[0].heading);
  });

  it('shows the theme picker only on the first page', async () => {
    await render();
    expect(container!.querySelector('[data-testid="tour-theme-ocean"]')).not.toBeNull();
    click('tour-next');
    expect(container!.querySelector('[data-testid="tour-theme-ocean"]')).toBeNull();
  });

  // The whole reason the theme step sits in this tour is that the preview
  // restyles as you choose one. Assert the chosen id actually reaches the
  // demo, not just that clicking a swatch doesn't crash.
  it('restyles the demo preview to match the picked theme', async () => {
    await render();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-theme-ocean"]')!.click();
    });
    const demo = container!.querySelector<HTMLElement>('[data-testid="web-demo"]')!;
    expect(demo.dataset.theme).toBe('ocean');
  });

  it('marks the tour complete and leaves when finished on the last page', async () => {
    await render();
    for (let i = 0; i < TOUR_STEPS.length - 1; i++) click('tour-next');
    expect(container!.textContent).toContain(TOUR_STEPS[TOUR_STEPS.length - 1].heading);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')!.click();
    });

    const patched = fetchMock.mock.calls.some(
      (c) => String(c[0]).includes('/api/onboarding') && String((c[1] as RequestInit)?.body).includes('tour_completed'),
    );
    expect(patched).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('marks the tour complete and leaves when skipped', async () => {
    await render();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-skip"]')!.click();
    });
    const patched = fetchMock.mock.calls.some(
      (c) => String(c[0]).includes('/api/onboarding') && String((c[1] as RequestInit)?.body).includes('tour_completed'),
    );
    expect(patched).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  // The tour must never trap anyone, so a failed PATCH still lets them out.
  it('still leaves when marking complete fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter><WelcomePage /></MemoryRouter>);
      await Promise.resolve();
    });
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-skip"]')!.click();
    });
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  // A PATCH that fails once is fine - the boot gate offers the tour again.
  // A PATCH that keeps failing must not ping-pong the user between / and
  // /welcome forever. finish() sets the local escape-hatch flag before
  // navigating regardless of whether the write landed, so this must hold
  // even on the failure path.
  it('sets the local tour-done flag even when the PATCH rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<MemoryRouter><WelcomePage /></MemoryRouter>);
      await Promise.resolve();
    });
    expect(sessionStorage.getItem(TOUR_DONE_KEY)).toBeNull();
    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-skip"]')!.click();
    });
    expect(sessionStorage.getItem(TOUR_DONE_KEY)).toBe('1');
  });

  // Inside the tour the viewer already has an account: the demos' own theme
  // pickers would be a redundant, non-functional second control, and the
  // toast's "Sign up free" link would navigate a signed-up user out of the
  // tour to wherever they came from. Both must be disabled on every preview.
  it('disables the demos own theme controls and sign-up CTA link on every page', async () => {
    await render();
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const web = container!.querySelector<HTMLElement>('[data-testid="web-demo"]')!;
      expect(web.dataset.showThemeControls).toBe('false');
      expect(web.dataset.ctaHref).toBe('null');
      if (i === 0) {
        const desktop = container!.querySelector<HTMLElement>('[data-testid="desktop-demo"]')!;
        const mobile = container!.querySelector<HTMLElement>('[data-testid="mobile-demo"]')!;
        expect(desktop.dataset.showThemeControls).toBe('false');
        expect(desktop.dataset.ctaHref).toBe('null');
        expect(mobile.dataset.showThemeControls).toBe('false');
        expect(mobile.dataset.ctaHref).toBe('null');
      }
      if (i < TOUR_STEPS.length - 1) click('tour-next');
    }
  });

  // The spec promises a different preview per page: sharing shows the
  // Shared view, security shows the Vault, integrations shows Integrations.
  // Welcome and Ready keep the demo's own default (dashboard, i.e. no seed).
  it('passes the expected view to the demo on each step', async () => {
    await render();
    const expected: Record<string, string | undefined> = {
      welcome: undefined,
      sharing: 'shared',
      security: 'vault',
      integrations: 'integrations',
      ready: undefined,
    };
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const step = TOUR_STEPS[i];
      const web = container!.querySelector<HTMLElement>('[data-testid="web-demo"]')!;
      expect(web.dataset.view).toBe(expected[step.id]);
      if (i < TOUR_STEPS.length - 1) click('tour-next');
    }
  });
});

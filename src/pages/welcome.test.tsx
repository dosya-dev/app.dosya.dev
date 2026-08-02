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
vi.mock('@/components/demo/WebDemo', () => ({ default: () => <div data-testid="web-demo" /> }));
vi.mock('@/components/demo/DesktopDemo', () => ({ default: () => <div data-testid="desktop-demo" /> }));
vi.mock('@/components/demo/MobileDemo', () => ({ default: () => <div data-testid="mobile-demo" /> }));

import WelcomePage from './welcome';
import { TOUR_STEPS } from '@/components/tour/tour-steps';

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
});

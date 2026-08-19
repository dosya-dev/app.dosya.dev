import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/turnstile-widget', () => ({
  TurnstileWidget: () => <div data-testid="turnstile" />,
}));

import LoginPage from './login';
import SignUpPage from './sign-up';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

/**
 * The GitHub button used to pair `variant="outline"` with a bg-primary
 * override. In dark mode the variant's `dark:bg-input/30` outranks the
 * un-prefixed `bg-primary`, so the background fell back to translucent dark
 * while `text-primary-foreground` stayed near-black - a dark button with dark
 * text and logo. Brand buttons must therefore style both halves explicitly
 * with a dark-mode flip, the way the Apple button always has.
 */
describe('OAuth brand buttons - dark mode legibility', () => {
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

  function brandButton(label: string): HTMLButtonElement {
    const btn = [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
    expect(btn, `expected a "${label}" button`).toBeTruthy();
    return btn!;
  }

  for (const [pageName, Page] of [['login', LoginPage], ['sign-up', SignUpPage]] as const) {
    it(`${pageName}: GitHub button flips to a light button in dark mode`, async () => {
      await render(Page);
      const github = brandButton('Continue with GitHub');
      expect(github.className).toContain('dark:bg-white');
      expect(github.className).toContain('dark:text-black');
      // The broken pairing: primary-pair text over a variant-controlled
      // background that goes dark in dark mode.
      expect(github.className).not.toContain('text-primary-foreground');
    });

    it(`${pageName}: Apple button keeps its dark-mode flip`, async () => {
      await render(Page);
      const apple = brandButton('Continue with Apple');
      expect(apple.className).toContain('dark:bg-white');
      expect(apple.className).toContain('dark:text-black');
    });
  }
});

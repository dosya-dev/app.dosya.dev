import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import WebDemo from './WebDemo';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Placeholder backs the vault, team and settings views. It used to render a
// hardcoded "Sign up free to use it" link straight from SIGNUP_URL,
// bypassing the ctaHref prop that DemoToast already respected - harmless
// while the tour only ever showed the dashboard, but a real leak once the
// tour started opening WebDemo directly on one of these views with
// ctaHref={null} (a signed-up viewer, told to sign up, with a live link out
// of the tour).
describe('Placeholder CTA link', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(node); });
  }

  it('is absent when ctaHref is null, on every placeholder view', () => {
    for (const view of ['vault', 'team', 'settings'] as const) {
      render(<WebDemo ctaHref={null} initialView={view} />);
      expect(container!.querySelector('a')).toBeNull();
      expect(container!.textContent).not.toContain('Sign up free to use it');
      // The rest of the placeholder still renders sensibly without the link.
      expect(container!.querySelector('p.text-base.font-semibold')).not.toBeNull();
      act(() => { root!.unmount(); });
      container!.remove();
    }
    root = null;
    container = null;
  });

  it('is present, pointing at ctaHref, when ctaHref is given', () => {
    render(<WebDemo ctaHref="/sign-up" initialView="vault" />);
    const link = container!.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/sign-up');
    expect(link!.textContent).toBe('Sign up free to use it');
  });

  it('defaults to the real sign-up URL when ctaHref is not passed, as the marketing site relies on', () => {
    render(<WebDemo initialView="vault" />);
    const link = container!.querySelector('a');
    expect(link).not.toBeNull();
    // SIGNUP_URL resolves to '/sign-up' outside prod (see demoData.ts); the
    // exact value is not the point here, only that a link exists at all.
    expect(link!.getAttribute('href')).toBeTruthy();
  });
});

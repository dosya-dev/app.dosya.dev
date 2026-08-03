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

// The tour keeps ONE WebDemo instance mounted as it moves between pages
// (sharing -> security -> integrations), changing the `initialView` prop on
// it each time rather than remounting. A plain `useState(() => ...)` lazy
// initializer only runs on the very first render, so without a resync
// effect the preview silently stays on whatever the first page set - the
// tour's per-page-preview promise (sharing shows Shared, security shows
// Vault, integrations shows Integrations) just would not hold. This exact
// scenario - re-rendering the SAME root with a new initialView, the way
// React reuses a component instance across prop updates - is what a test
// that only checks the prop was passed (see welcome.test.tsx's stubbed
// "passes the expected view to the demo on each step") cannot catch.
describe('initialView re-sync on the same mounted instance', () => {
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

  function rerender(node: React.ReactNode) {
    act(() => { root!.render(node); });
  }

  it('switches the rendered view when initialView changes on a re-render, not just at mount', () => {
    render(<WebDemo initialView="shared" />);
    expect(container!.querySelector('h1')!.textContent).toBe('Shared');
    expect(container!.textContent).not.toContain('A separate, extra-protected space');

    rerender(<WebDemo initialView="vault" />);
    expect(container!.textContent).toContain('A separate, extra-protected space for your most sensitive files.');
    expect(container!.querySelector('h1')).toBeNull(); // Vault is a Placeholder, not SharedView's <h1>

    rerender(<WebDemo initialView="integrations" />);
    expect(container!.textContent).not.toContain('A separate, extra-protected space');
  });

  it('does not clobber an in-demo sidebar selection until initialView actually changes', () => {
    render(<WebDemo initialView="shared" />);
    const settingsBtn = Array.from(container!.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Settings')!;
    act(() => { settingsBtn.click(); });
    expect(container!.textContent).toContain('Appearance, security, storage and workspace preferences.');

    // Re-rendering with the SAME initialView must not fight the manual
    // selection back - the resync effect is keyed on state.initialView and
    // must only fire when that value actually changes.
    rerender(<WebDemo initialView="shared" />);
    expect(container!.textContent).toContain('Appearance, security, storage and workspace preferences.');

    // A genuinely new initialView still wins, same as the tour moving pages.
    rerender(<WebDemo initialView="vault" />);
    expect(container!.textContent).toContain('A separate, extra-protected space for your most sensitive files.');
  });

  it('starts on dashboard and stays fully user-driven when initialView is never passed (marketing default)', () => {
    render(<WebDemo />);
    expect(container!.textContent).toContain('Good afternoon');
    const sharedBtn = Array.from(container!.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'Shared')!;
    act(() => { sharedBtn.click(); });
    expect(container!.querySelector('h1')!.textContent).toBe('Shared');
    // Re-rendering with no initialView at all (as every marketing call site
    // does) must not reset the user's own navigation.
    rerender(<WebDemo />);
    expect(container!.querySelector('h1')!.textContent).toBe('Shared');
  });
});

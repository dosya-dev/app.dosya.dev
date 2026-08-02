import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { SetupPill } from './setup-pill';
import { useOnboarding } from '@/stores/onboarding';
import { useWorkspace } from '@/stores/workspace';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const NONE = {
  upload: false, share: false, import: false, api_key: false, client_used: false,
  invite: false, file_request: false, geo: false, desktop: false, mobile: false,
};

// The dev purpose's four steps: upload, api_key, client_used, share.
const DEV_ALL_DONE = { ...NONE, upload: true, api_key: true, client_used: true, share: true };

// Captured before any test can replace it, so it can be restored between
// tests that stub `dismiss` to assert call counts.
const REAL_DISMISS = useOnboarding.getState().dismiss;

describe('SetupPill', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
    // loaded: true keeps the priming effect from firing a real fetch; each
    // test overrides purpose/steps/dismissed as needed.
    useOnboarding.setState({ purpose: 'dev', dismissed: false, steps: NONE, loaded: true, failed: false, dismiss: REAL_DISMISS });
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<MemoryRouter><SetupPill /></MemoryRouter>); });
  }

  it('renders nothing when dismissed is true', () => {
    useOnboarding.setState({ dismissed: true, steps: { ...NONE, upload: true } });
    render();
    expect(container!.querySelector('[data-testid="setup-pill"]')).toBeNull();
    expect(container!.textContent).toBe('');
  });

  it('renders nothing when steps is null (the onboarding fetch failed)', () => {
    useOnboarding.setState({ steps: null, loaded: true, failed: true });
    render();
    expect(container!.querySelector('[data-testid="setup-pill"]')).toBeNull();
    expect(container!.textContent).toBe('');
  });

  it('renders nothing when every step in the active purpose set is complete', () => {
    useOnboarding.setState({ purpose: 'dev', steps: DEV_ALL_DONE });
    render();
    expect(container!.querySelector('[data-testid="setup-pill"]')).toBeNull();
    expect(container!.textContent).toBe('');
  });

  it('renders the pill with correct done/total text when there is unfinished setup', () => {
    useOnboarding.setState({ purpose: 'dev', steps: { ...NONE, upload: true } });
    render();
    const pill = container!.querySelector('[data-testid="setup-pill"]');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('Setup 1/4');
  });

  it('counts progress only over the active purpose set, not unrelated derivations', () => {
    // geo and mobile are media-purpose derivations; with purpose "dev" they
    // must not count toward, or complete, the pill's progress.
    useOnboarding.setState({ purpose: 'dev', steps: { ...NONE, upload: true, geo: true, mobile: true } });
    render();
    const pill = container!.querySelector('[data-testid="setup-pill"]');
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toContain('Setup 1/4');
  });

  // The first-run home screen shows this same checklist inline exactly when
  // the workspace has no files - i.e. exactly when `upload` is false. The
  // pill must not duplicate it.
  it('renders nothing when upload is not done, even with other steps complete', () => {
    useOnboarding.setState({ purpose: 'dev', steps: { ...NONE, api_key: true, client_used: true, share: true } });
    render();
    expect(container!.querySelector('[data-testid="setup-pill"]')).toBeNull();
    expect(container!.textContent).toBe('');
  });

  describe('auto-dismiss on completion', () => {
    it('calls dismiss exactly once when the active purpose set becomes complete', () => {
      const dismiss = vi.fn(async () => { useOnboarding.setState({ dismissed: true }); });
      useOnboarding.setState({ purpose: 'dev', steps: DEV_ALL_DONE, dismissed: false, dismiss });
      render();
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(container!.querySelector('[data-testid="setup-pill"]')).toBeNull();
    });

    it('does not call dismiss when already dismissed', () => {
      const dismiss = vi.fn(async () => {});
      useOnboarding.setState({ purpose: 'dev', steps: DEV_ALL_DONE, dismissed: true, dismiss });
      render();
      expect(dismiss).not.toHaveBeenCalled();
    });

    it('does not call dismiss when setup is incomplete', () => {
      const dismiss = vi.fn(async () => {});
      useOnboarding.setState({ purpose: 'dev', steps: { ...NONE, upload: true }, dismissed: false, dismiss });
      render();
      expect(dismiss).not.toHaveBeenCalled();
    });
  });
});

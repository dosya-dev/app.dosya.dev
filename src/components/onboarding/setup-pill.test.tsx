import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
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

describe('SetupPill', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useWorkspace.setState({ activeId: 'ws_1' });
    // loaded: true keeps the priming effect from firing a real fetch; each
    // test overrides purpose/steps/dismissed as needed.
    useOnboarding.setState({ purpose: 'dev', dismissed: false, steps: NONE, loaded: true, failed: false });
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
});

import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const enqueue = vi.fn();
vi.mock('@/lib/upload-runner', () => ({ enqueue: (...a: unknown[]) => enqueue(...a) }));

import { FirstRunHome } from './first-run-home';
import { useOnboarding } from '@/stores/onboarding';
import { useWorkspace } from '@/stores/workspace';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const NONE = {
  upload: false, share: false, import: false, api_key: false, client_used: false,
  invite: false, file_request: false, geo: false, desktop: false, mobile: false,
};

describe('FirstRunHome', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    enqueue.mockClear();
    useWorkspace.setState({ activeId: 'ws_1' });
    useOnboarding.setState({ purpose: null, dismissed: false, steps: NONE, loaded: true, failed: false });
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
    act(() => { root!.render(<MemoryRouter><FirstRunHome userName="Jane Doe" /></MemoryRouter>); });
  }

  it('greets the user by first name', () => {
    render();
    expect(container!.textContent).toContain('Jane');
    expect(container!.textContent).not.toContain('Jane Doe');
  });

  it('shows the purpose picker while the purpose is unanswered', () => {
    render();
    expect(container!.querySelector('[data-testid="purpose-dev"]')).not.toBeNull();
  });

  it('replaces the picker with the checklist once a purpose is set', () => {
    useOnboarding.setState({ purpose: 'dev' });
    render();
    expect(container!.querySelector('[data-testid="purpose-dev"]')).toBeNull();
    expect(container!.querySelector('[data-testid="step-api_key"]')).not.toBeNull();
  });

  it('sends dropped files to the shared upload runner', () => {
    render();
    const zone = container!.querySelector('[data-testid="first-run-dropzone"]')!;
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    act(() => {
      const ev = new Event('drop', { bubbles: true }) as Event & { dataTransfer?: unknown };
      Object.defineProperty(ev, 'dataTransfer', { value: { files: [file] } });
      zone.dispatchEvent(ev);
    });
    expect(enqueue).toHaveBeenCalledWith([file], { workspace_id: 'ws_1', folder_id: null });
  });

  // Onboarding must never be load-bearing: a failed fetch leaves steps null,
  // and the screen still has to offer the thing that matters most.
  it('still renders the dropzone when onboarding state failed to load', () => {
    useOnboarding.setState({ steps: null, failed: true });
    render();
    expect(container!.querySelector('[data-testid="first-run-dropzone"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="step-upload"]')).toBeNull();
  });
});

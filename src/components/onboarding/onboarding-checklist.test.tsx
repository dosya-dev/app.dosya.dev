import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { OnboardingChecklist, completedCount } from './onboarding-checklist';
import type { StepFlags } from '@/stores/onboarding';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const NONE: StepFlags = {
  upload: false, share: false, import: false, api_key: false, client_used: false,
  invite: false, file_request: false, geo: false, desktop: false, mobile: false,
};

describe('completedCount', () => {
  it('counts only the steps in the active set', () => {
    // geo is true but is not in the dev set, so it must not be counted.
    expect(completedCount('dev', { ...NONE, upload: true, geo: true })).toEqual({ done: 1, total: 4 });
  });

  it('counts the generic set when the purpose is unanswered', () => {
    expect(completedCount(null, { ...NONE, upload: true, share: true })).toEqual({ done: 2, total: 4 });
  });
});

describe('OnboardingChecklist', () => {
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
    act(() => { root!.render(<MemoryRouter>{node}</MemoryRouter>); });
  }

  it('renders the four steps of the active purpose', () => {
    render(<OnboardingChecklist purpose="team" steps={NONE} />);
    expect(container!.querySelectorAll('[data-testid^="step-"]')).toHaveLength(4);
    expect(container!.querySelector('[data-testid="step-invite"]')).not.toBeNull();
  });

  it('marks a step done from derived state, not from a click', () => {
    render(<OnboardingChecklist purpose="team" steps={{ ...NONE, upload: true }} />);
    expect(container!.querySelector('[data-testid="step-upload"]')!.getAttribute('data-done')).toBe('true');
    expect(container!.querySelector('[data-testid="step-invite"]')!.getAttribute('data-done')).toBe('false');
  });

  it('shows progress out of the set size', () => {
    render(<OnboardingChecklist purpose="team" steps={{ ...NONE, upload: true, share: true }} />);
    expect(container!.textContent).toContain('2 of 4');
  });

  it('hides the per-step reason in compact mode', () => {
    render(<OnboardingChecklist purpose="dev" steps={NONE} compact />);
    expect(container!.textContent).not.toContain('One key authenticates');
  });
});

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TourLayout } from './tour-layout';
import { TOUR_STEPS } from './tour-steps';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('TourLayout', () => {
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

  const base = {
    step: TOUR_STEPS[1],
    index: 1,
    total: 5,
    onBack: () => {},
    onNext: () => {},
    onSkip: () => {},
    preview: <div data-testid="preview" />,
  };

  it('renders the heading, every point, and the preview', () => {
    render(<TourLayout {...base} />);
    expect(container!.textContent).toContain(TOUR_STEPS[1].heading);
    for (const p of TOUR_STEPS[1].points) expect(container!.textContent).toContain(p.title);
    expect(container!.querySelector('[data-testid="preview"]')).not.toBeNull();
  });

  it('shows progress as one dot per page with the current one marked', () => {
    render(<TourLayout {...base} />);
    const dots = container!.querySelectorAll('[data-testid^="tour-dot-"]');
    expect(dots).toHaveLength(5);
    expect(container!.querySelector('[data-testid="tour-dot-1"]')!.getAttribute('data-current')).toBe('true');
    expect(container!.querySelector('[data-testid="tour-dot-0"]')!.getAttribute('data-current')).toBe('false');
  });

  it('reports next, back and skip', () => {
    const onNext = vi.fn(); const onBack = vi.fn(); const onSkip = vi.fn();
    render(<TourLayout {...base} onNext={onNext} onBack={onBack} onSkip={onSkip} />);
    act(() => { container!.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')!.click(); });
    act(() => { container!.querySelector<HTMLButtonElement>('[data-testid="tour-back"]')!.click(); });
    act(() => { container!.querySelector<HTMLButtonElement>('[data-testid="tour-skip"]')!.click(); });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('hides Back on the first page', () => {
    render(<TourLayout {...base} index={0} />);
    expect(container!.querySelector('[data-testid="tour-back"]')).toBeNull();
  });

  it('labels the last page Finish rather than Next', () => {
    render(<TourLayout {...base} step={TOUR_STEPS[4]} index={4} />);
    expect(container!.querySelector('[data-testid="tour-next"]')!.textContent).toContain('Finish');
  });

  it('renders the extra slot when given one', () => {
    render(<TourLayout {...base} extra={<div data-testid="extra" />} />);
    expect(container!.querySelector('[data-testid="extra"]')).not.toBeNull();
  });

  // The preview is a vendored third-party-ish component tree. If it throws,
  // the user must still get the words and the buttons rather than a blank
  // screen with no way forward.
  it('keeps the copy and controls when the preview throws', () => {
    const Boom = () => { throw new Error('demo exploded'); };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<TourLayout {...base} preview={<Boom />} />);
    expect(container!.textContent).toContain(TOUR_STEPS[1].heading);
    expect(container!.querySelector('[data-testid="tour-next"]')).not.toBeNull();
    expect(container!.querySelector('[data-testid="preview"]')).toBeNull();
    consoleError.mockRestore();
  });
});

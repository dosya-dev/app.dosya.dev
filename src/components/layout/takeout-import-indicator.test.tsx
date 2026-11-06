import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Progress } from '@/lib/takeout/runner';

const { TakeoutImportIndicator } = await import('./takeout-import-indicator');
const { useTakeoutImport } = await import('@/stores/takeout-import');
const { TooltipProvider } = await import('@/components/ui/tooltip');

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const initial = useTakeoutImport.getState();

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  useTakeoutImport.setState(initial, true);
});

const progress = (over: Partial<Progress> = {}): Progress => ({
  total: 4, totalBytes: 400, done: 1, doneBytes: 100, resumed: 0, datesApplied: 0, placesApplied: 0, failures: [], ...over,
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(TooltipProvider, null, createElement(TakeoutImportIndicator)));
  });
  return container;
}

const offset = (el: HTMLElement) => Number(el.querySelectorAll('circle')[1].getAttribute('stroke-dashoffset'));

describe('TakeoutImportIndicator', () => {
  it('renders nothing before an import starts', async () => {
    const el = await render();
    expect(el.querySelector('[data-testid=takeout-import-ring]')).toBeNull();
  });

  it('fills the ring by bytes while an import runs', async () => {
    useTakeoutImport.setState({ phase: 'running', progress: progress() });
    const el = await render();
    expect(el.querySelector('[data-testid=takeout-import-ring]')).not.toBeNull();
    const quarter = offset(el);
    await act(async () => { useTakeoutImport.setState({ progress: progress({ done: 3, doneBytes: 300 }) }); });
    expect(offset(el)).toBeLessThan(quarter);
  });

  it('stays up, greyed, while the import is paused', async () => {
    useTakeoutImport.setState({ phase: 'paused', progress: progress() });
    const el = await render();
    expect(el.querySelectorAll('circle')[1].getAttribute('stroke')).toBe('var(--muted-foreground)');
  });

  it('goes away once the import is done or stopped', async () => {
    for (const phase of ['done', 'stopped'] as const) {
      useTakeoutImport.setState({ phase, progress: progress({ done: 4, doneBytes: 400 }) });
      const el = await render();
      expect(el.querySelector('[data-testid=takeout-import-ring]')).toBeNull();
      await act(async () => { root?.unmount(); });
      container?.remove();
      root = null;
    }
  });
});

import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const applyTheme = vi.fn();
const writeCache = vi.fn();
vi.mock('@/lib/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/theme')>();
  return {
    ...actual,
    applyTheme: (...a: unknown[]) => applyTheme(...a),
    writeCache: (...a: unknown[]) => writeCache(...a),
    readCache: () => ({ theme: 'default', mode: 'system' }),
  };
});

import { ThemeStep } from './theme-step';
import { THEMES } from '@/lib/themes';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ThemeStep', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => { applyTheme.mockClear(); writeCache.mockClear(); });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null; container = null;
    vi.restoreAllMocks();
  });

  function render(onThemeChange = () => {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => { root!.render(<ThemeStep onThemeChange={onThemeChange} />); });
  }

  it('offers every theme in the catalogue', () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })));
    render();
    expect(container!.querySelectorAll('[data-testid^="tour-theme-"]')).toHaveLength(THEMES.length);
  });

  // The three-way apply is the whole point of putting theme choice here: the
  // app restyles, the choice persists, and the preview the user is looking at
  // changes with it.
  it('applies the theme, persists it, and reports it to the preview', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const onThemeChange = vi.fn();
    render(onThemeChange);

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-theme-ocean"]')!.click();
    });

    expect(applyTheme).toHaveBeenCalledWith(expect.objectContaining({ theme: 'ocean' }));
    expect(onThemeChange).toHaveBeenCalledWith('ocean');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/me/appearance');
  });

  it('keeps the selection when persisting fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const onThemeChange = vi.fn();
    render(onThemeChange);

    await act(async () => {
      container!.querySelector<HTMLButtonElement>('[data-testid="tour-theme-amber"]')!.click();
    });

    expect(applyTheme).toHaveBeenCalledWith(expect.objectContaining({ theme: 'amber' }));
    expect(onThemeChange).toHaveBeenCalledWith('amber');
    expect(container!.querySelector('[data-testid="tour-theme-amber"]')!.getAttribute('data-selected')).toBe('true');
  });
});

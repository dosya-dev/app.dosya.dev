import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/api/req', () => ({ req: vi.fn(async () => ({ ok: true })) }));
import AppearanceSection from './appearance';
import { I18nProvider } from '@/lib/i18n';
import { LOCALES } from '@/i18n/locales';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

describe('Profile > Appearance language field', () => {
  it('shows the current language and opens the list', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<AppearanceSection />); });
    const btn = container.querySelector('[data-testid=language-field-button]') as HTMLElement;
    expect(btn.textContent).toContain('English');
    await act(async () => { btn.click(); });
    expect(container.querySelectorAll('[role=menuitemradio]').length).toBe(LOCALES.length);
  });

  it('shows the heading and note in English by default', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<I18nProvider initial="en"><AppearanceSection /></I18nProvider>); });
    expect(container.textContent).toContain('Language');
    expect(container.textContent).toContain('Saved on this browser only.');
  });

  it('shows the heading and note in Turkish when the language is Turkish', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const messages = {
      'appearance.label.language': 'Dil',
      'profile.description.savedOnThisBrowserOnly': 'Yalnızca bu tarayıcıda kaydedilir.',
    };
    await act(async () => {
      root!.render(<I18nProvider initial="tr" initialMessages={messages}><AppearanceSection /></I18nProvider>);
    });
    expect(container.textContent).toContain('Dil');
    expect(container.textContent).toContain('Yalnızca bu tarayıcıda kaydedilir.');
    expect(container.textContent).not.toContain('Saved on this browser only.');
    // Back to English for the tests after this one.
    act(() => root!.unmount());
    root = createRoot(container);
    await act(async () => { root!.render(<I18nProvider initial="en"><span /></I18nProvider>); });
  });
});

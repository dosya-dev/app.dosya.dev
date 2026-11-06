import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { LanguageMenu } from './language-menu';
import { LanguageField } from './language-field';
import { LOCALES, LOCALE_LABELS } from '@/i18n/locales';
import shipped from '@/i18n/shipped.json';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  localStorage.clear();
  const probe = document.createElement('div');
  const r = createRoot(probe);
  await act(async () => { r.render(<I18nProvider initial="en"><span /></I18nProvider>); });
  act(() => r.unmount());
});

// Language chunks load asynchronously; under a loaded machine that can take a while.
const waitFor = async (cond: () => boolean, timeout = 2500) => {
  const end = Date.now() + timeout;
  while (!cond() && Date.now() < end) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<I18nProvider initial="en">{node}</I18nProvider>); });
}

describe('LanguageMenu', () => {
  it('lists every shipped language and switches on pick (compact, as in both headers)', async () => {
    await mount(<LanguageMenu />);
    const btn = container!.querySelector('[data-testid=language-menu-button]') as HTMLElement;
    expect(btn.textContent).toBe('en');
    await act(async () => { btn.click(); });
    const items = container!.querySelectorAll('[role=menuitemradio]');
    expect(items.length).toBe(LOCALES.length);
    const tr = [...items].find((i) => i.textContent === 'Türkçe') as HTMLElement;
    await act(async () => { tr.click(); });
    await waitFor(() => btn.textContent === 'tr');
    expect(container!.querySelector('[role=menu]')).toBeNull();
    expect(btn.textContent).toBe('tr');
    expect(localStorage.getItem('dosya_locale')).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
  });

  it('closes on Escape', async () => {
    await mount(<LanguageMenu />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    expect(container!.querySelector('[role=menu]')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(container!.querySelector('[role=menu]')).toBeNull();
  });
});

describe('LanguageField', () => {
  it('shows the current language by name and opens the same list', async () => {
    await mount(<LanguageField />);
    const btn = container!.querySelector('[data-testid=language-field-button]') as HTMLElement;
    expect(btn.textContent).toContain('English');
    await act(async () => { btn.click(); });
    expect(container!.querySelectorAll('[role=menuitemradio]').length).toBe(LOCALES.length);
    const de = [...container!.querySelectorAll('[role=menuitemradio]')].find((i) => i.textContent === 'Deutsch') as HTMLElement;
    await act(async () => { de.click(); });
    await waitFor(() => btn.textContent!.includes('Deutsch'));
    expect(btn.textContent).toContain('Deutsch');
  });
});

describe('names only, no flags', () => {
  it('renders every shipped language by its own name, with no svg flag in any row', async () => {
    await mount(<LanguageMenu />);
    await act(async () => { (container!.querySelector('[data-testid=language-menu-button]') as HTMLElement).click(); });
    const items = [...container!.querySelectorAll('[role=menuitemradio]')];
    const names = items.map((i) => i.querySelector('[lang]')?.textContent);
    for (const code of ['en', ...(shipped as string[])]) expect(names, code).toContain(LOCALE_LABELS[code as keyof typeof LOCALE_LABELS]);
    expect(names).toEqual(LOCALES.map((l) => LOCALE_LABELS[l]));
    // No flag anywhere: the only svg in the list is the active row's check mark.
    expect(items.filter((i) => i.getAttribute('aria-checked') !== 'true' && i.querySelector('svg')).map((i) => i.textContent)).toEqual([]);
    expect(items.find((i) => i.getAttribute('aria-checked') === 'true')!.querySelectorAll('svg').length).toBe(1);
    expect(container!.querySelector('[data-testid=language-menu-button] svg')).toBeNull();
  });

  it('the ar row carries lang="ar" and dir="rtl" on its name, sized to the text so it lines up at the inline start', async () => {
    await mount(<LanguageMenu />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    const row = [...container!.querySelectorAll('[role=menuitemradio]')].find((i) => i.textContent === 'العربية') as HTMLElement;
    const name = row.querySelector('[lang]') as HTMLElement;
    expect(name.getAttribute('lang')).toBe('ar');
    expect(name.getAttribute('dir')).toBe('rtl');
    expect(name.className).not.toContain('flex-1');
    expect(name.className).toContain('lang-name');
  });
});

describe('right-to-left languages in the picker', () => {
  it('lists ar, he and fa by their own names, each label with its own lang and dir', async () => {
    await mount(<LanguageMenu />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    for (const [code, label] of [['ar', 'العربية'], ['he', 'עברית'], ['fa', 'فارسی']] as const) {
      const span = [...container!.querySelectorAll('[role=menuitemradio] span')].find((s) => s.textContent === label) as HTMLElement;
      expect(span, code).toBeDefined();
      expect(span.getAttribute('lang')).toBe(code);
      expect(span.getAttribute('dir')).toBe('rtl');
    }
    const de = [...container!.querySelectorAll('[role=menuitemradio] span')].find((s) => s.textContent === 'Deutsch') as HTMLElement;
    expect(de.getAttribute('dir')).toBe('ltr');
  });

  it('the seven European languages show their own names', async () => {
    await mount(<LanguageMenu />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    for (const label of ['Български', 'Hrvatski', 'Slovenčina', 'Slovenščina', 'Eesti', 'Latviešu', 'Lietuvių']) {
      const span = [...container!.querySelectorAll('[role=menuitemradio] span')].find((s) => s.textContent === label) as HTMLElement;
      expect(span, label).toBeDefined();
      expect(span.getAttribute('dir')).toBe('ltr');
    }
  });

  it('the six regional and Slavic languages show their own names', async () => {
    await mount(<LanguageMenu />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    for (const label of ['Português (Portugal)', 'Українська', 'Српски', 'Русский', 'Español (Latinoamérica)', 'Français (Canada)']) {
      const span = [...container!.querySelectorAll('[role=menuitemradio] span')].find((s) => s.textContent === label) as HTMLElement;
      expect(span, label).toBeDefined();
      expect(span.getAttribute('dir')).toBe('ltr');
    }
  });

  it('align end puts the menu at the inline end, align start at the inline start', async () => {
    await mount(<LanguageMenu align="end" />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    expect(container!.querySelector('[role=menu]')!.className).toContain('end-0');
    act(() => root!.unmount()); container!.remove(); root = null;
    await mount(<LanguageMenu align="start" />);
    await act(async () => { (container!.querySelector('button') as HTMLElement).click(); });
    expect(container!.querySelector('[role=menu]')!.className).toContain('start-0');
  });
});

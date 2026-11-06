import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const reload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/chunk-reload', () => ({
  recoverFromChunkErrorInBrowser: reload,
  recoverFromChunkError: reload,
}));
// `gate.ar` holds the Arabic chunk back until a test releases it (a slow load).
const gate = vi.hoisted(() => ({ ar: null as Promise<void> | null, heFails: false }));
vi.mock('@/i18n/loaders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/loaders')>();
  return {
    LOADERS: {
      ...actual.LOADERS,
      de: () => Promise.reject(new Error('chunk missing')),
      he: () => (gate.heFails ? Promise.reject(new Error('chunk missing')) : actual.LOADERS.he()),
      ar: async () => {
        await gate.ar;
        return actual.LOADERS.ar();
      },
    },
  };
});

import { I18nProvider, bootI18n, currentDir, onLocaleChange, useDir, isLanguageLoadInFlight, loadStartupMessages, useLocale, useT, t } from './i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { richText } from '@/lib/rich-text';
import { useDirection } from '@base-ui/react/direction-provider';
import { useDocumentTitle } from '@/lib/page-title';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { parseIcu, type IcuNode } from '@/i18n/icu';
import { makeT } from '@/i18n/translator';
import enCatalog from '@/i18n/messages/en.json';
import type { MessageKey } from '@/i18n/keys';

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  localStorage.clear();
  reload.mockReset();
  // Back to English for the next test.
  const probe = document.createElement('div');
  const r = createRoot(probe);
  await act(async () => { r.render(<I18nProvider initial="en"><span /></I18nProvider>); });
  act(() => r.unmount());
});

function Probe() {
  const tt = useT();
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <span data-testid="text">{tt('common.cancel')}</span>
      <span data-testid="loc">{locale}</span>
      <button data-testid="to-tr" onClick={() => void setLocale('tr')} />
      <button data-testid="to-de" onClick={() => setLocale('de').catch(() => {})} />
    </div>
  );
}

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}
// Language chunks load asynchronously; under a loaded machine that can take a while.
const waitFor = async (cond: () => boolean, timeout = 2500) => {
  const end = Date.now() + timeout;
  while (!cond() && Date.now() < end) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const q = (id: string) => document.querySelector(`[data-testid=${id}]`) as HTMLElement;

describe('loadStartupMessages', () => {
  it('falls back to English when the language chunk fails, without the chunk-reload recovery', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await loadStartupMessages('de');
    expect(r.locale).toBe('en');
    expect(r.messages['common.cancel']).toBe('Cancel');
    expect(reload).not.toHaveBeenCalled();
  });
  it('loads Turkish', async () => {
    const r = await loadStartupMessages('tr');
    expect(r.locale).toBe('tr');
    expect(r.messages['common.cancel']).toBe('İptal');
  });
});

describe('provider', () => {
  it('switches t() without a remount and follows html lang, a dialog included', async () => {
    await mount(
      <I18nProvider initial="en">
        <Probe />
        <Dialog open>
          <DialogContent>
            <DialogTitle>x</DialogTitle>
            <DialogProbe />
          </DialogContent>
        </Dialog>
      </I18nProvider>,
    );
    expect(q('text').textContent).toBe('Cancel');
    expect(document.documentElement.lang).toBe('en');
    const node = q('text');
    await act(async () => { q('to-tr').click(); });
    await waitFor(() => q('text').textContent === 'İptal');
    expect(q('text')).toBe(node);
    expect(q('text').textContent).toBe('İptal');
    expect(q('dlg').textContent).toBe('İptal');
    expect(document.documentElement.lang).toBe('tr');
    expect(t('common.cancel')).toBe('İptal');
    expect(localStorage.getItem('dosya_locale')).toBe('tr');
  });

  it('keeps the current language and stores nothing when a chunk fails', async () => {
    await mount(<I18nProvider initial="en"><Probe /></I18nProvider>);
    await act(async () => { q('to-de').click(); });
    await waitFor(() => !isLanguageLoadInFlight());
    expect(q('loc').textContent).toBe('en');
    expect(localStorage.getItem('dosya_locale')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('follows a storage event for dosya_locale', async () => {
    await mount(<I18nProvider initial="en"><Probe /></I18nProvider>);
    localStorage.setItem('dosya_locale', 'tr');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'dosya_locale', newValue: 'tr' }));
    });
    await waitFor(() => q('text').textContent === 'İptal');
    expect(q('text').textContent).toBe('İptal');
  });
});

function DialogProbe() {
  const tt = useT();
  return <span data-testid="dlg">{tt('common.cancel')}</span>;
}

describe('bootI18n', () => {
  it('first render already shows the stored language', async () => {
    localStorage.setItem('dosya_locale', 'tr');
    const frames: string[] = [];
    function Login() {
      const tt = useT();
      frames.push(tt('common.cancel'));
      return <span>{tt('common.cancel')}</span>;
    }
    const { locale, messages } = await bootI18n();
    await mount(<I18nProvider initial={locale} initialMessages={messages}><Login /></I18nProvider>);
    expect(frames[0]).toBe('İptal');
    expect(frames).not.toContain('Cancel');
  });
  it('boots English with nothing stored', async () => {
    expect((await bootI18n()).locale).toBe('en');
  });
});

function DirProbe() {
  const dir = useDir();
  const base = useDirection();
  return <span data-testid="dir">{dir}|{base}</span>;
}

describe('direction', () => {
  it('boots with a stored RTL language: the first frame is already right to left', async () => {
    localStorage.setItem('dosya_locale', 'ar');
    const frames: string[] = [];
    function Frame() {
      frames.push(`${document.documentElement.lang}:${document.documentElement.dir}`);
      return <span />;
    }
    const { locale, messages } = await bootI18n();
    await mount(<I18nProvider initial={locale} initialMessages={messages}><Frame /></I18nProvider>);
    expect(frames[0]).toBe('ar:rtl');
    expect(frames.every((f) => f === 'ar:rtl')).toBe(true);
  });

  it('boots a left-to-right language with dir ltr', async () => {
    await mount(<I18nProvider initial="en"><span /></I18nProvider>);
    expect(document.documentElement.dir).toBe('ltr');
    expect(currentDir()).toBe('ltr');
  });

  it('sets lang and dir in the same activation: subscribers and listeners already see both', async () => {
    const seen: string[] = [];
    function Watch() {
      const { locale } = useLocale();
      seen.push(`${locale}|${document.documentElement.lang}|${document.documentElement.dir}`);
      return null;
    }
    let setter: ((l: 'fa') => Promise<void>) | null = null;
    function Grab() {
      // eslint-disable-next-line react-hooks/globals -- the test captures the setter to call it later
      setter = useLocale().setLocale as (l: 'fa') => Promise<void>;
      return null;
    }
    const heard: string[] = [];
    const off = onLocaleChange((l) => heard.push(`${l}|${document.documentElement.lang}|${document.documentElement.dir}`));
    await mount(<I18nProvider initial="en"><Watch /><Grab /></I18nProvider>);
    await act(async () => { await setter!('fa'); });
    off();
    expect(document.documentElement.lang).toBe('fa');
    expect(document.documentElement.dir).toBe('rtl');
    expect(seen.filter((x) => x.startsWith('fa'))).toEqual(seen.filter((x) => x.startsWith('fa')).map(() => 'fa|fa|rtl'));
    expect(seen).not.toContain('fa|en|ltr');
    expect(seen).not.toContain('en|fa|rtl');
    expect(heard).toEqual(['fa|fa|rtl']);
  });

  it('A then B ends with B: a slow Arabic load landing late does not leave dir rtl', async () => {
    let release!: () => void;
    gate.ar = new Promise<void>((r) => { release = r; });
    let setter!: (l: 'ar' | 'tr') => Promise<void>;
    // eslint-disable-next-line react-hooks/globals -- the test captures the setter to call it later
    function Grab() { setter = useLocale().setLocale; return null; }
    await mount(<I18nProvider initial="en"><Probe /><Grab /></I18nProvider>);
    let first!: Promise<void>;
    await act(async () => { first = setter('ar'); });
    await act(async () => { await setter('tr'); });
    expect(document.documentElement.dir).toBe('ltr');
    release();
    await act(async () => { await first; });
    gate.ar = null;
    expect(document.documentElement.lang).toBe('tr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(q('loc').textContent).toBe('tr');
  });

  it('a rejected load leaves lang and dir unchanged', async () => {
    localStorage.setItem('dosya_locale', 'ar');
    const { locale, messages } = await bootI18n();
    gate.heFails = true;
    let setter!: (l: 'he') => Promise<void>;
    // eslint-disable-next-line react-hooks/globals -- the test captures the setter to call it later
    function Grab() { setter = useLocale().setLocale as typeof setter; return null; }
    await mount(<I18nProvider initial={locale} initialMessages={messages}><Grab /></I18nProvider>);
    await act(async () => { await setter('he').catch(() => {}); });
    gate.heFails = false;
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('a storage event to fa flips dir in place while a dialog is open, and the portalled dialog sees rtl', async () => {
    await mount(
      <I18nProvider initial="en">
        <DirProbe />
        <Dialog open>
          <DialogContent>
            <DialogTitle>x</DialogTitle>
            <span data-testid="dlg-dir"><DirProbeInDialog /></span>
          </DialogContent>
        </Dialog>
      </I18nProvider>,
    );
    expect(q('dir').textContent).toBe('ltr|ltr');
    localStorage.setItem('dosya_locale', 'fa');
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'dosya_locale', newValue: 'fa' }));
    });
    await waitFor(() => document.documentElement.dir === 'rtl');
    expect(document.documentElement.dir).toBe('rtl');
    expect(q('dir').textContent).toBe('rtl|rtl');
    expect(q('dlg-dir').textContent).toBe('rtl|rtl');
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });
});

function DirProbeInDialog() {
  return <DirProbe />;
}

describe('isolation', () => {
  const FSI = '\u2068';
  const PDI = '\u2069';
  const switchTo = async (l: 'ar' | 'he' | 'fa' | 'en' | 'fr' | 'tr') => {
    const { loadMessages: load } = await import('./i18n');
    const messages = await load(l);
    const el = document.createElement('div');
    const r = createRoot(el);
    await act(async () => { r.render(<I18nProvider initial={l} initialMessages={messages}><span /></I18nProvider>); });
    act(() => r.unmount());
  };

  it('wraps a string value in isolates in ar, he and fa', async () => {
    for (const l of ['ar', 'he', 'fa'] as const) {
      await switchTo(l);
      expect(document.documentElement.lang).toBe(l);
      expect(t('files.label.nameFiles', { name: 'report (1).pdf' }), l).toContain(`${FSI}report (1).pdf${PDI}`);
    }
  });

  it('leaves English, French and Turkish output exactly as before', async () => {
    for (const l of ['en', 'fr', 'tr'] as const) {
      await switchTo(l);
      const out = t('files.label.nameFiles', { name: 'report (1).pdf' });
      expect(out).toContain('report (1).pdf');
      expect(out).not.toMatch(/[\u2066-\u2069]/);
    }
  });

  it('does not wrap numbers, and plural selection still sees them', async () => {
    await switchTo('ar');
    const out = t('save-share.feedback.filesSavedSkipped', { saved: 3, skipped: 0, name: 'a', reason: 'b' });
    expect(out).not.toMatch(/[\u2066-\u2069]/);
    const one = t('save-share.feedback.filesSavedSkipped', { saved: 1, skipped: 0, name: 'a', reason: 'b' });
    expect(one).not.toBe(out);
  });

  it('document.title in ar carries the isolated name', async () => {
    await switchTo('ar');
    function Title() {
      useT();
      useDocumentTitle(t('files.label.nameFiles', { name: 'Q3 (final)' }));
      return null;
    }
    const { loadMessages: load } = await import('./i18n');
    const messages = await load('ar');
    await mount(<I18nProvider initial="ar" initialMessages={messages}><Title /></I18nProvider>);
    expect(document.title).toContain(`${FSI}Q3 (final)${PDI}`);
  });

  it('richText slots are React nodes and are never wrapped', async () => {
    await switchTo('ar');
    const out = renderToStaticMarkup(<>{richText(t('common.label.replyingToName', { name: 'x' }).replace(`${FSI}x${PDI}`, '{n}'), { n: <b>Ada</b> })}</>);
    expect(out).toContain('<b>Ada</b>');
    expect(out).not.toContain(FSI);
  });
});

describe('isolation never touches choice values', () => {
  const ISO = /[\u2066-\u2069]/g;
  const strip = (s: string) => s.replace(ISO, '');
  const switchTo = async (l: 'ar' | 'he' | 'fa') => {
    const { loadMessages: load } = await import('./i18n');
    const messages = await load(l);
    const el = document.createElement('div');
    const r = createRoot(el);
    await act(async () => { r.render(<I18nProvider initial={l} initialMessages={messages}><span /></I18nProvider>); });
    act(() => r.unmount());
    return messages;
  };

  // Every select message in the English catalog, with its selector names, its
  // plural names and its plain argument names.
  type Shape = { key: string; selects: Map<string, string[]>; plurals: Set<string>; plain: Set<string> };
  const shapes: Shape[] = [];
  for (const [key, src] of Object.entries(enCatalog as Record<string, string>)) {
    const shape: Shape = { key, selects: new Map(), plurals: new Set(), plain: new Set() };
    const walk = (list: IcuNode[]) => {
      for (const n of list) {
        if (typeof n === 'string' || n.type === 'pound') continue;
        if (n.type === 'arg') shape.plain.add(n.name);
        else {
          if (n.type === 'select') shape.selects.set(n.name, [...(shape.selects.get(n.name) ?? []), ...Object.keys(n.options)]);
          else shape.plurals.add(n.name);
          for (const b of Object.values(n.options)) walk(b);
        }
      }
    };
    walk(parseIcu(src));
    if (shape.selects.size) shapes.push(shape);
  }

  it('finds the 52 select messages', () => {
    // 52 since the calendar viewer added common.description.repeatMonthlyNth (its ordinal is a select), 2026-11-02.
    expect(shapes.length).toBe(52); // last: editor.description.nameSavedVersionWhen (text editor conflict dialog)
  });

  it('every select in ar, he and fa takes the branch its raw value picks', async () => {
    for (const l of ['ar', 'he', 'fa'] as const) {
      const messages = await switchTo(l);
      // The same catalog without any isolation: the branch the value really picks.
      const raw = makeT(l, messages, enCatalog as Record<string, string>);
      let checked = 0;
      for (const shape of shapes) {
        for (const [sel, options] of shape.selects) {
          for (const option of options) {
            const values: Record<string, string | number> = {};
            for (const p of shape.plain) values[p] = 'Q3 (final)';
            for (const p of shape.plurals) values[p] = 2;
            for (const other of shape.selects.keys()) values[other] = 'zz-none';
            values[sel] = option;
            const key = shape.key as MessageKey;
            expect(strip(t(key, values)), `${l} ${shape.key} ${sel}=${option}`).toBe(strip(raw(key, values)));
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(100);
    }
  });

  it('a cancelling plan reads "ends" (not "renews") in ar', async () => {
    const messages = await switchTo('ar');
    const key = 'billing.description.plannamePlanSubcancelAtPeriodEndSelectTrueEndsOtherRenewsSubcurrentPeriodEnd' as MessageKey;
    const ending = t(key, { planName: 'Pro', subCancel_at_period_end: 'true', subCurrent_period_end: 'Nov 1' });
    const renewing = t(key, { planName: 'Pro', subCancel_at_period_end: 'false', subCurrent_period_end: 'Nov 1' });
    expect(ending).not.toBe(renewing);
    const raw = makeT('ar', messages, enCatalog as Record<string, string>);
    expect(strip(ending)).toBe(raw(key, { planName: 'Pro', subCancel_at_period_end: 'true', subCurrent_period_end: 'Nov 1' }));
    // The plain arguments are still isolated.
    expect(ending).toContain('\u2068Pro\u2069');
    expect(ending).toContain('\u2068Nov 1\u2069');
  });

  it('a plural plus a select plus a plain name: the count and the flag choose, the name is isolated', async () => {
    const messages = await switchTo('he');
    const key = 'common.description.yourAccountIsScheduledForDeletionOnScheduledforHasdays' as MessageKey;
    const raw = makeT('he', messages, enCatalog as Record<string, string>);
    for (const days of [1, 2, 5]) {
      for (const hasDays of ['true', 'false']) {
        const out = t(key, { scheduledFor: 'Nov 1', hasDays, days });
        expect(strip(out)).toBe(raw(key, { scheduledFor: 'Nov 1', hasDays, days }));
        expect(out).toContain('\u2068Nov 1\u2069');
      }
    }
    expect(t(key, { scheduledFor: 'Nov 1', hasDays: 'true', days: 1 })).not.toBe(t(key, { scheduledFor: 'Nov 1', hasDays: 'true', days: 5 }));
    expect(t(key, { scheduledFor: 'Nov 1', hasDays: 'true', days: 5 })).not.toBe(t(key, { scheduledFor: 'Nov 1', hasDays: 'false', days: 5 }));
  });
});

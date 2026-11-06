/**
 * Leftover-English sweep for component tests.
 *
 * Renders a component under I18nProvider in a target language, reads every
 * visible text node and the attributes users hear or see (aria-label, title,
 * placeholder) from the whole document (portalled menus included), and returns
 * the texts that are still English.
 *
 * "Still English" is decided by the strict text matcher (src/i18n/match.ts),
 * built from the web catalog's English messages and the target language's
 * messages: a text is leftover only when the matcher recognises it as the
 * English of a catalog key AND the language has different text for that key.
 * Text the catalog does not know (user data, server text, proper nouns) is
 * never reported. Later tasks extend this helper rather than writing another.
 *
 * The RTL helpers at the bottom (physicalClassesIn, unflippedIcons) check a
 * rendered tree for physical-direction classes and for direction-carrying
 * icons that do not flip.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Locale } from '@/i18n/locales';
import { createTextMatcher, type TextMatcher } from '@/i18n/match';
import type { Messages } from '@/i18n/translator';
import en from '@/i18n/messages/en.json';
import { I18nProvider, loadMessages } from '@/lib/i18n';
// @ts-expect-error plain .mjs script without types
import { classify } from '../../scripts/rtl-codemod.mjs';

const ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'] as const;

const matchers = new Map<Locale, TextMatcher>();

/** A strict matcher over every catalog key for `locale`. */
function matcherFor(locale: Locale, messages: Messages): TextMatcher {
  let m = matchers.get(locale);
  if (!m) {
    const english = en as Record<string, string>;
    const strings = Object.keys(english).map((key) => ({ key, source: english[key] }));
    m = createTextMatcher({ strings }, messages, locale, { strict: true });
    matchers.set(locale, m);
  }
  return m;
}

/** Every visible text and attribute value under `root`, trimmed, in document order. */
export function collectTexts(root: ParentNode = document.body): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const parent = (n as Text).parentElement;
      if (parent && /^(SCRIPT|STYLE)$/.test(parent.tagName)) continue;
      const text = (n.textContent ?? '').trim();
      if (text) out.push(text);
    } else {
      for (const attr of ATTRIBUTES) {
        const v = (n as Element).getAttribute(attr)?.trim();
        if (v) out.push(v);
      }
    }
  }
  return out;
}

/** The texts in `texts` that are English the language has a different text for. */
export function leftoverEnglish(texts: string[], locale: Locale, messages: Messages): string[] {
  const matcher = matcherFor(locale, messages);
  const seen = new Set<string>();
  for (const text of texts) {
    const translated = matcher.translate(text);
    if (translated !== null && translated !== text) seen.add(text);
  }
  return [...seen];
}

export interface Rendered {
  container: HTMLElement;
  /** Leftover English on the whole document right now. */
  leftover(): string[];
  unmount(): void;
}

/** Renders `ui` under I18nProvider in `locale`, waiting for the language file. */
export async function renderInLocale(ui: ReactElement, locale: Locale): Promise<Rendered> {
  const messages = await loadMessages(locale);
  const { lang: prevLang, dir: prevDir } = document.documentElement;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <I18nProvider initial={locale} initialMessages={locale === 'en' ? undefined : messages}>
        {ui}
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return {
    container,
    leftover: () => leftoverEnglish(collectTexts(document.body), locale, messages),
    unmount() {
      act(() => root.unmount());
      container.remove();
      // The provider sets lang and dir on <html>; leave the document as it was found.
      if (prevLang) document.documentElement.lang = prevLang;
      else document.documentElement.removeAttribute('lang');
      if (prevDir) document.documentElement.dir = prevDir;
      else document.documentElement.removeAttribute('dir');
    },
  };
}

/** Icon classes (lucide renders `lucide-<name>`) that point somewhere. A trailing `*` is a prefix. */
export const DIRECTIONAL_ICONS: readonly string[] = [
  'lucide-chevron-left',
  'lucide-chevron-right',
  'lucide-chevrons-left',
  'lucide-chevrons-right',
  'lucide-arrow-left',
  'lucide-arrow-right',
  'lucide-arrow-up-right',
  'lucide-corner-down-right',
  'lucide-reply',
  'lucide-send',
  'lucide-log-out',
  'lucide-log-in',
  'lucide-panel-left*',
  'lucide-panel-right*',
  'lucide-undo*',
  'lucide-redo*',
];

function isDirectional(cls: string): boolean {
  return DIRECTIONAL_ICONS.some((d) => (d.endsWith('*') ? cls.startsWith(d.slice(0, -1)) : cls === d));
}

function elementsIn(root: ParentNode): Element[] {
  const all = Array.from(root.querySelectorAll('*'));
  return root instanceof Element ? [root, ...all] : all;
}

/**
 * Physical-direction classes (ml-2, text-left, left-0 ...) on elements under
 * `root`. Subtrees under `[dir="ltr"]` are ignored, and so is a left-1/2 or
 * right-1/2 that sits with -translate-x-1/2 (a centering pair). Only classes
 * with a logical form are returned; translate-x and origin are not.
 */
export function physicalClassesIn(root: ParentNode = document.body): string[] {
  const out: string[] = [];
  for (const el of elementsIn(root)) {
    if (el.closest('[dir="ltr"]')) continue;
    const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const centered = classes.some((c) => classify(c)?.centeringKey === 'translate');
    for (const c of classes) {
      const info = classify(c);
      if (!info || info.kind !== 'convertible') continue;
      if (centered && info.centeringKey === 'inset') continue;
      out.push(c);
    }
  }
  return out;
}

/**
 * Directional icons under `root` that do not flip in RTL: an SVG with a class in
 * DIRECTIONAL_ICONS and neither `rtl:-scale-x-100` nor `rtl:rotate-180` (nor `rotate-90`), outside
 * any `[dir="ltr"]`. Returns the icon class of each offender.
 */
export function unflippedIcons(root: ParentNode = document.body): string[] {
  const out: string[] = [];
  for (const svg of Array.from(root.querySelectorAll('svg'))) {
    if (svg.closest('[dir="ltr"]')) continue;
    const classes = (svg.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const icon = classes.find(isDirectional);
    if (!icon) continue;
    if (classes.includes('rtl:-scale-x-100') || classes.includes('rtl:rotate-180')) continue;
    // A chevron turned 90 degrees (an open disclosure) points down, not sideways.
    if (classes.includes('rotate-90')) continue;
    out.push(icon);
  }
  return out;
}

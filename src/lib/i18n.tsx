import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { isLocale, localeDir, type Locale } from '@/i18n/locales';
import { makeT, type Messages, type T } from '@/i18n/translator';
import { parseIcu, type IcuNode } from '@/i18n/icu';
import { LOADERS } from '@/i18n/loaders';
import en from '@/i18n/messages/en.json';
import { readStoredLocale, subscribeStoredLocale, writeStoredLocale } from '@/lib/locale-store';

/**
 * The app's UI language.
 *
 * One module-level store holds the current locale and its translator. React
 * reads it through useT()/useLocale() (useSyncExternalStore, so every consumer
 * re-renders in place on a switch, portalled dialogs included); plain modules
 * use the exported `t`, which always translates with the current locale, and
 * onLocaleChange() when they cache text.
 *
 * English is bundled; every other language is its own chunk. A language that
 * fails to load leaves the app in English. This module deliberately does not
 * use chunk-reload: that guard reloads the tab for stale page chunks, and a
 * missing language file must never do that.
 */

const english: Messages = en;

/** The messages for `locale`: English is already here, the rest load as chunks. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  if (locale === 'en') return english;
  languageLoadsInFlight++;
  try {
    return (await LOADERS[locale]()).default;
  } finally {
    languageLoadsInFlight--;
  }
}

let languageLoadsInFlight = 0;

/**
 * True while a language file is loading. Vite dispatches `vite:preloadError`
 * for every failed dynamic import; main.tsx's recovery listener checks this so
 * a missing language file never reloads the tab (it falls back to English).
 */
export const isLanguageLoadInFlight = (): boolean => languageLoadsInFlight > 0;

/** The starting language's messages; English if its chunk cannot be loaded. */
export async function loadStartupMessages(locale: Locale): Promise<{ locale: Locale; messages: Messages }> {
  try {
    return { locale, messages: await loadMessages(locale) };
  } catch (err) {
    console.error('[i18n] could not load', locale, '- starting in English:', err);
    return { locale: 'en', messages: english };
  }
}

/** First strong isolate and pop directional isolate: keep a substituted value's own direction. */
const FSI = '\u2068';
const PDI = '\u2069';

/**
 * The names a message substitutes as plain text ({name}, {n, number}), which
 * never steer a select or plural. A name that picks a branch anywhere in the
 * message is left out: its value must reach the selector exactly as given.
 */
function simpleArgs(nodes: IcuNode[]): Set<string> {
  const plain = new Set<string>();
  const choosers = new Set<string>();
  const walk = (list: IcuNode[]) => {
    for (const n of list) {
      if (typeof n === 'string' || n.type === 'pound') continue;
      if (n.type === 'arg') plain.add(n.name);
      else {
        choosers.add(n.name);
        for (const branch of Object.values(n.options)) walk(branch);
      }
    }
  };
  walk(nodes);
  for (const name of choosers) plain.delete(name);
  return plain;
}

/** Parses `src`, or undefined when it is missing or broken (makeT then falls back). */
const tryParse = (src: string | undefined): IcuNode[] | undefined => {
  if (src === undefined) return undefined;
  try {
    return parseIcu(src);
  } catch {
    return undefined;
  }
};

/**
 * In a right-to-left language a Latin file name or an English server message
 * dropped into a sentence would reorder its punctuation. Wrapping each plain
 * string argument in an isolate keeps it intact. Values that choose a select
 * or plural branch are passed through untouched (an isolated "true" would
 * match no branch), and numbers are left alone (digits are not reordered).
 */
function buildT(locale: Locale, messages: Messages): T {
  const base = makeT(locale, messages, english);
  if (localeDir(locale) !== 'rtl') return base;
  // Parsed once per key, from the same message makeT renders: the
  // translation, or English when the translation is missing or broken.
  const plainArgs = new Map<string, Set<string>>();
  const plainFor = (key: string): Set<string> => {
    let names = plainArgs.get(key);
    if (!names) {
      const nodes = tryParse(messages[key]) ?? tryParse(english[key]);
      names = nodes ? simpleArgs(nodes) : new Set();
      plainArgs.set(key, names);
    }
    return names;
  };
  return (key, values) => {
    if (!values) return base(key, values);
    const plain = plainFor(key);
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(values)) {
      out[k] = typeof v === 'string' && v !== '' && plain.has(k) ? FSI + v + PDI : v;
    }
    return base(key, out);
  };
}

interface Snapshot {
  locale: Locale;
  /** Layout direction of `locale`. */
  dir: 'ltr' | 'rtl';
  t: T;
  /** The language's messages, for the strict matcher in lib/external-text.ts. */
  messages: Messages;
}

let snapshot: Snapshot = { locale: 'en', dir: 'ltr', t: makeT('en', english, english), messages: english };
const subscribers = new Set<() => void>();
const listeners = new Set<(l: Locale) => void>();
// Bumped by every switch request, so a slow load never lands after a newer one.
let generation = 0;
let pending: Locale | null = null;

function activate(locale: Locale, messages: Messages): void {
  const changed = locale !== snapshot.locale;
  const dir = localeDir(locale);
  snapshot = { locale, dir, t: buildT(locale, messages), messages };
  // lang and dir change together, before anything re-renders, so no frame
  // shows one language in the other's direction.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }
  for (const fn of subscribers) fn();
  if (!changed) return;
  for (const fn of listeners) {
    try {
      fn(locale);
    } catch (err) {
      console.error('[i18n] locale listener failed:', err);
    }
  }
}

const subscribe = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
const getSnapshot = (): Snapshot => snapshot;

/** Translates with whatever locale is current at call time. */
export const t: T = (key, values) => snapshot.t(key, values);

/** The current locale, for code outside React. */
export const currentLocale = (): Locale => snapshot.locale;

/** The layout direction of the current language, for code outside React. */
// eslint-disable-next-line react-refresh/only-export-components -- non-component helper, like the other accessors here
export const currentDir = (): 'ltr' | 'rtl' => snapshot.dir;

/** The current language's messages (the object changes on a switch). */
export const currentMessages = (): Messages => snapshot.messages;

/** Called after each switch. Returns the unsubscribe. */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Loads `locale` and shows it, unless a newer request came in meanwhile. */
async function switchTo(locale: Locale, mine: number): Promise<void> {
  const messages = await loadMessages(locale);
  if (mine === generation) activate(locale, messages);
}

/**
 * Switches the app to `locale` and remembers it on this browser. The old
 * language stays on screen until the new one has loaded; a failed load keeps
 * the old language and stores nothing.
 */
async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale) || locale === (pending ?? snapshot.locale)) return;
  const mine = ++generation;
  pending = locale;
  try {
    await switchTo(locale, mine);
    if (mine === generation) writeStoredLocale(locale);
  } finally {
    if (mine === generation) pending = null;
  }
}

/** Follows the language chosen in another tab (the stored value is already written). */
function followStored(locale: Locale): void {
  if (locale === (pending ?? snapshot.locale)) return;
  const mine = ++generation;
  pending = locale;
  switchTo(locale, mine)
    .catch((err) => console.error('[i18n] could not load', locale, err))
    .finally(() => {
      if (mine === generation) pending = null;
    });
}

/**
 * Resolves the stored language and loads its messages. main.tsx awaits this
 * before the first render so a non-English start never shows an English frame.
 */
export async function bootI18n(): Promise<{ locale: Locale; messages: Messages }> {
  return loadStartupMessages(readStoredLocale());
}

/** Sets the starting language (see bootI18n) and follows the other tabs. */
export function I18nProvider({
  initial,
  initialMessages,
  children,
}: {
  initial: Locale;
  initialMessages?: Messages;
  children: ReactNode;
}) {
  const primed = useRef(false);
  if (!primed.current) {
    primed.current = true;
    generation++;
    if (initial === 'en') activate('en', english);
    else if (initialMessages) activate(initial, initialMessages);
  }
  useEffect(() => {
    if (initial !== 'en' && !initialMessages && snapshot.locale !== initial) {
      void switchTo(initial, generation).catch((err) => console.error('[i18n] could not load', initial, err));
    }
  }, [initial, initialMessages]);
  useEffect(() => subscribeStoredLocale(followStored), []);
  const { dir } = useSyncExternalStore(subscribe, getSnapshot);
  return <DirectionProvider direction={dir}>{children}</DirectionProvider>;
}

/** The layout direction of the current language; re-renders on a switch. */
// eslint-disable-next-line react-refresh/only-export-components -- hook, like useT and useLocale
export function useDir(): 'ltr' | 'rtl' {
  return useSyncExternalStore(subscribe, getSnapshot).dir;
}

/** t() for the current locale; the component re-renders when it changes. */
export function useT(): T {
  return useSyncExternalStore(subscribe, getSnapshot).t;
}

export function useLocale(): { locale: Locale; setLocale(l: Locale): Promise<void> } {
  const { locale } = useSyncExternalStore(subscribe, getSnapshot);
  return { locale, setLocale };
}

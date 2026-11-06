import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseIcu, type IcuNode } from './icu';
import { LOCALES, type Locale } from './locales';

// Catalog hygiene checks. English sources and the 18 language files are
// vendored into src/i18n/messages (inside apps/web); the catalog itself
// (translate flags) lives in packages/i18n/web and exists in the monorepo only.

const messagesDir = resolve(__dirname, 'messages');
const catalogPath = resolve(__dirname, '../../../../packages/i18n/web/en.catalog.json');
const languages = LOCALES.filter((l) => l !== 'en');

const read = (file: string): Record<string, string> => JSON.parse(readFileSync(resolve(messagesDir, file), 'utf8'));
const english = read('en.json');
const byLanguage: Record<string, Record<string, string>> = Object.fromEntries(languages.map((l) => [l, read(`${l}.json`)]));

/** Every message of every file: [file, key, text]. */
const everyMessage: [string, string, string][] = [
  ...Object.entries(english).map(([k, v]): [string, string, string] => ['en', k, v]),
  ...languages.flatMap((l) => Object.entries(byLanguage[l]).map(([k, v]): [string, string, string] => [l, k, v])),
];

const RTL_LANGUAGES = ['ar', 'he', 'fa'] as const;
const EXISTING_LANGUAGES = languages.filter((l) => !(RTL_LANGUAGES as readonly string[]).includes(l));

const offenders = (test: (text: string) => boolean, only?: string): string[] =>
  everyMessage.filter(([file, , text]) => (only ? file === only : true) && test(text)).map(([file, key]) => `${file}:${key}`);

describe('catalog placeholders and quoting', () => {
  it('has no placeholder name containing a $ inside {...}', () => {
    expect(offenders((t) => /\{[^}]*\$[^}]*\}/.test(t))).toEqual([]);
  });

  it("has no quote directly before a brace, except the help search (this runtime has no apostrophe quoting, so '{q}' renders 'foo')", () => {
    expect(offenders((t) => t.includes("'{")).filter((o) => !o.endsWith(':common.action.searchTheHelpCenterForQ'))).toEqual([]);
  });

  it('has no HTML entity in any English or translated message', () => {
    expect(offenders((t) => /&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/.test(t))).toEqual([]);
  });

  it('has no doubled space in any English source', () => {
    expect(offenders((t) => /  /.test(t), 'en')).toEqual([]);
  });

  it('has no markdown bold markers in any message', () => {
    expect(offenders((t) => t.includes('**'))).toEqual([]);
  });
});

describe('right-to-left languages', () => {
  it('ships ar, he and fa', () => {
    for (const l of RTL_LANGUAGES) expect(LOCALES as readonly Locale[]).toContain(l);
  });

  it('has no hand-placed bidi control character in any RTL language file (isolation is the runtime job)', () => {
    const bidi = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
    const bad = RTL_LANGUAGES.flatMap((l) => Object.entries(byLanguage[l] ?? {}).filter(([, v]) => bidi.test(v)).map(([k]) => `${l}:${k}`));
    expect(bad).toEqual([]);
  });

  it.skipIf(!existsSync(catalogPath))('vendors every language byte for byte from packages/i18n/web', () => {
    const dir = resolve(__dirname, '../../../../packages/i18n/web');
    for (const l of EXISTING_LANGUAGES) {
      const want = JSON.stringify(JSON.parse(readFileSync(resolve(dir, `${l}.json`), 'utf8')), null, 2) + '\n';
      expect(readFileSync(resolve(messagesDir, `${l}.json`), 'utf8') === want, l).toBe(true);
    }
  });
});

describe('the From key', () => {
  it('no longer has the shared common.label.from', () => {
    expect(english['common.label.from']).toBeUndefined();
    for (const l of languages) expect(byLanguage[l]['common.label.from'], l).toBeUndefined();
  });

  it('has the range start and the sender as two English keys', () => {
    expect(english['map.label.from']).toBe('From');
    expect(english['shared.label.from']).toBe('From');
  });

  it('keeps a translation for the range start in every language', () => {
    for (const l of languages) expect(byLanguage[l]['map.label.from'], l).toBeTruthy();
  });

  it('keeps the two Hungarian words', () => {
    expect(byLanguage.hu['map.label.from']).toBe('Ettől');
    expect(byLanguage.hu['shared.label.from']).toBe('Feladó');
  });
});

describe.skipIf(!existsSync(catalogPath))('translate:false keys', () => {
  const catalog = (JSON.parse(readFileSync(catalogPath, 'utf8')) as { strings: { key: string; translate?: boolean }[] }).strings;
  const untranslated = catalog.filter((s) => s.translate === false).map((s) => s.key);

  it('includes the two identifier keys', () => {
    expect(untranslated).toContain('sign-in.label.signup');
    expect(untranslated).toContain('share-analytics.label.insidetopright');
  });

  it('has no value in any language file', () => {
    const withValue = untranslated.flatMap((key) => languages.filter((l) => key in byLanguage[l]).map((l) => `${l}:${key}`));
    expect(withValue).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Coverage gate: catalog <-> code <-> language files.
// ---------------------------------------------------------------------------

interface CatalogEntry {
  key: string;
  source: string;
  translate?: boolean;
  reuseMobile?: string;
}

/**
 * Catalog keys that no production file in apps/web/src names as a literal, yet
 * must stay. Every entry needs a reason; the list is exact (an entry that is
 * used after all, or no longer in the catalog, fails the gate).
 */
const UNUSED_ALLOWLIST: Record<string, string> = {
  'common.error.passwordMustBeAtLeast8Characters':
    'same English as profile.error.passwordMustBeAtLeast8Characters; kept because sharing-sweep.test.tsx asserts its text for the file request edit dialog',
  'common.heading.keyboardShortcuts':
    'the video player labels (packages/video-player) carry this title; shared-text-sweep.test.tsx asserts it, the web code never names it',
  'connect-ai.description.verifiedCredirecthostCbySelectTrueByCbyOther':
    'defective old key (select cannot carry its value); kept only for the carriedMessage check in vault-sweep.test.tsx',
  'connect-lightroom.description.allowRequestdeviceNameRequestpluginVersionSelectTruePlugInRequestpluginVersionOtherTo':
    'defective old key (select cannot carry its value); kept only for the carriedMessage check in vault-sweep.test.tsx',
  'connect-lightroom.description.requestdeviceNamelightroomIsConnectedWorkspacenameSelectTrueToWorkspacenameOtherThe':
    'defective old key (select cannot carry its value); kept only for the carriedMessage check in vault-sweep.test.tsx',
  'support-chat.description.dosyaSupportClosedThisConversationReplyToReopenIt':
    'round-one live chat closed line; ended conversations no longer reopen, so the thread shows support-chat.label.conversationEnded. Drop with the next catalog regeneration',
};

const srcDir = resolve(__dirname, '..');

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'messages' || name === 'node_modules') continue;
      productionFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(name) && !/\.test\./.test(name) && name !== 'keys.ts') {
      out.push(full);
    }
  }
  return out;
}

function placeholderNames(nodes: IcuNode[], into = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (typeof n === 'string' || n.type === 'pound') continue;
    into.add(n.name);
    if (n.type === 'plural' || n.type === 'select') for (const branch of Object.values(n.options)) placeholderNames(branch, into);
  }
  return into;
}

/** Every plural node in a message, with the categories it names. */
function pluralOptions(nodes: IcuNode[], into: string[][] = []): string[][] {
  for (const n of nodes) {
    if (typeof n === 'string' || n.type === 'pound' || n.type === 'arg') continue;
    if (n.type === 'plural') into.push(Object.keys(n.options));
    for (const branch of Object.values(n.options)) pluralOptions(branch, into);
  }
  return into;
}

describe.skipIf(!existsSync(catalogPath))('catalog coverage gate', () => {
  const entries = (JSON.parse(readFileSync(catalogPath, 'utf8')) as { strings: CatalogEntry[] }).strings;
  const catalogKeys = new Set(entries.map((e) => e.key));
  const translatable = entries.filter((e) => e.translate !== false);

  const files = productionFiles(srcDir);
  const sources = files.map((f) => readFileSync(f, 'utf8'));
  const literal = /['"`]([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)['"`]/g;
  const literals = new Set<string>();
  for (const text of sources) for (const m of text.matchAll(literal)) literals.add(m[1]);

  it('scans a plausible set of production files', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(literals.size).toBeGreaterThan(2000);
  });

  it('(a) every translatable key is used in apps/web/src or allowlisted with a reason', () => {
    const unused = translatable.map((e) => e.key).filter((k) => !literals.has(k) && !(k in UNUSED_ALLOWLIST));
    expect(unused).toEqual([]);
  });

  it('(a) the allowlist holds only keys that are in the catalog and still unused', () => {
    for (const [key, reason] of Object.entries(UNUSED_ALLOWLIST)) {
      expect(catalogKeys.has(key), `${key} is not in the catalog any more`).toBe(true);
      expect(literals.has(key), `${key} is used now, drop it from the allowlist`).toBe(false);
      expect(reason.length, key).toBeGreaterThan(20);
    }
  });

  it('(b) every key named in code exists in the catalog', () => {
    // A key is a t( first argument, or any literal shaped screen.role.name whose screen and role
    // are the catalog's own (keys lists, tables of keys).
    const screens = new Set(entries.map((e) => e.key.split('.')[0]));
    const roles = new Set(entries.map((e) => e.key.split('.')[1]).filter((r): r is string => !!r));
    const call = /\bt\(\s*['"`]([^'"`$]+)['"`]/g;
    const missing = new Set<string>();
    for (const text of sources) {
      for (const m of text.matchAll(call)) if (!catalogKeys.has(m[1])) missing.add(m[1]);
    }
    for (const lit of literals) {
      const [screen, role] = lit.split('.');
      if (screens.has(screen) && roles.has(role) && lit.split('.').length >= 3 && !catalogKeys.has(lit)) missing.add(lit);
    }
    expect([...missing].sort()).toEqual([]);
  });

  describe.each(languages)('%s', (lang) => {
    const messages = byLanguage[lang];
    const required = translatable;
    const mobileMissing = translatable.filter((e) => e.reuseMobile !== undefined && !(e.key in messages));

    it('(c) has every key that is translatable and not waiting for the mobile copy', () => {
      expect(required.filter((e) => !(e.key in messages)).map((e) => e.key)).toEqual([]);
    });

    it('(c) has no key the catalog does not know', () => {
      expect(Object.keys(messages).filter((k) => !catalogKeys.has(k))).toEqual([]);
    });

    it('(c) keeps the placeholder names of the English source', () => {
      const bad: string[] = [];
      for (const e of translatable) {
        const text = messages[e.key];
        if (text === undefined) continue;
        const want = [...placeholderNames(parseIcu(e.source))].sort().join(',');
        let got: string;
        try {
          got = [...placeholderNames(parseIcu(text))].sort().join(',');
        } catch (err) {
          bad.push(`${e.key}: does not parse (${(err as Error).message})`);
          continue;
        }
        if (got !== want) bad.push(`${e.key}: {${got}} instead of {${want}}`);
      }
      expect(bad).toEqual([]);
    });

    it('(c) uses only plural categories the language has', () => {
      const allowed = new Set(new Intl.PluralRules(lang).resolvedOptions().pluralCategories);
      const bad: string[] = [];
      for (const e of translatable) {
        const text = messages[e.key];
        if (text === undefined) continue;
        for (const options of pluralOptions(parseIcu(text))) {
          const invalid = options.filter((o) => !/^=\d+$/.test(o) && !allowed.has(o as Intl.LDMLPluralRule));
          if (invalid.length > 0) bad.push(`${e.key}: ${invalid.join(',')}`);
          if (!options.includes('other')) bad.push(`${e.key}: no "other" branch`);
        }
      }
      expect(bad).toEqual([]);
    });

    // The mobile-copied keys may stay missing while the mobile language is unfinished: reported, never failed.
    it(`(d) reports ${mobileMissing.length} of ${translatable.length - required.length} reuseMobile keys still missing (allowed)`, () => {
      for (const e of mobileMissing) expect(e.reuseMobile).toBeTruthy();
    });
  });
});

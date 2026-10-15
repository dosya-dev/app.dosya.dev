import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EXTENSION_STORES, detectBrowser, getStore, FALLBACK_STORE } from './browser-extension';

const MARKETING = resolve(import.meta.dirname, '../../../../src/lib/extension-stores.ts');

// Real user agents. The first two are the whole reason detection is ordered.
const UA = {
  // Contains "Chrome" AND "Safari".
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  // Contains "Safari".
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0',
  safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
};

describe('detectBrowser', () => {
  it('does not call Edge "Chrome", or Chrome "Safari"', () => {
    expect(detectBrowser(UA.edge)).toBe('edge');
    expect(detectBrowser(UA.chrome)).toBe('chrome');
    expect(detectBrowser(UA.safari)).toBe('safari');
    expect(detectBrowser(UA.firefox)).toBe('firefox');
  });

  it('falls back to the one store that is certainly live', () => {
    expect(detectBrowser('')).toBe('chrome');
    expect(detectBrowser('Googlebot/2.1')).toBe('chrome');
    expect(FALLBACK_STORE.slug).toBe('chrome');
    expect(FALLBACK_STORE.published).toBe(true);
  });
});

describe('the store catalogue tracks the marketing site', () => {
  const marketing = readFileSync(MARKETING, 'utf8');

  /**
   * The expensive drift. `published` flips when a store approves the listing,
   * and it flips on the marketing site first because that is where the
   * verification note lives. A stale copy here either links a listing that
   * still 404s, or keeps hiding one that went live.
   */
  it('agrees on which listings are published', () => {
    for (const store of EXTENSION_STORES) {
      const block = marketing.match(
        new RegExp(`slug: "${store.slug}"[\\s\\S]*?published: (true|false)`),
      );
      expect(block, `no ${store.slug} entry on the marketing site`).not.toBeNull();
      expect(block![1] === 'true', `${store.slug}: published`).toBe(store.published);
    }
  });

  it('agrees on every listing URL', () => {
    for (const store of EXTENSION_STORES) {
      expect(marketing, `${store.slug}: listing URL`).toContain(store.listingUrl);
    }
  });

  it('covers the same four browsers', () => {
    const theirs = [...marketing.matchAll(/slug: "(chrome|firefox|edge|safari)"/g)].map((m) => m[1]);
    expect(EXTENSION_STORES.map((s) => s.slug).sort()).toEqual([...new Set(theirs)].sort());
  });
});

describe('what the page is allowed to render', () => {
  it('ships a logo for every browser', () => {
    for (const store of EXTENSION_STORES) {
      const file = resolve(import.meta.dirname, '../../public', `.${store.logo}`);
      expect(existsSync(file), `apps/web/public${store.logo}`).toBe(true);
    }
  });

  it('resolves a slug to its store', () => {
    expect(getStore('safari').storeName).toBe('Mac App Store');
    expect(getStore('chrome').published).toBe(true);
  });
});

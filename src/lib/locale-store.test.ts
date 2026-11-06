import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStoredLocale, subscribeStoredLocale, writeStoredLocale } from './locale-store';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('readStoredLocale', () => {
  it('is English with no stored value', () => {
    expect(readStoredLocale()).toBe('en');
  });
  it.each(['xx', '', 'tr ', '{"a":1}', 'TR'])('is English for %j', (v) => {
    localStorage.setItem('dosya_locale', v);
    expect(readStoredLocale()).toBe('en');
  });
  it('reads a shipped code', () => {
    localStorage.setItem('dosya_locale', 'pt-BR');
    expect(readStoredLocale()).toBe('pt-BR');
  });
  it('is English when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredLocale()).toBe('en');
  });
});

describe('writeStoredLocale', () => {
  it('stores the code', () => {
    writeStoredLocale('de');
    expect(localStorage.getItem('dosya_locale')).toBe('de');
  });
  it('swallows storage errors', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => writeStoredLocale('de')).not.toThrow();
  });
});

describe('subscribeStoredLocale', () => {
  it('reports the new value on a storage event and stops after unsubscribe', () => {
    const fn = vi.fn();
    const off = subscribeStoredLocale(fn);
    localStorage.setItem('dosya_locale', 'fr');
    window.dispatchEvent(new StorageEvent('storage', { key: 'dosya_locale', newValue: 'fr' }));
    expect(fn).toHaveBeenCalledWith('fr');
    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: 'x' }));
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new StorageEvent('storage', { key: 'dosya_locale', newValue: 'fr' }));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

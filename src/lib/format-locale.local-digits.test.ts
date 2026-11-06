import { afterEach, describe, expect, it, vi } from 'vitest';

// A browser set to Arabic (Egypt): navigator says so, and Intl's default
// locale (what `undefined` resolves to) prints Arabic-Indic digits.
const RealNumberFormat = Intl.NumberFormat;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('localDigits in English on an Arabic browser', () => {
  it('prints exactly String(n)', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'ar-EG', languages: ['ar-EG'] });
    vi.spyOn(Intl, 'NumberFormat').mockImplementation(function (locales?: string | string[], opts?: Intl.NumberFormatOptions) {
      return new RealNumberFormat(locales ?? 'ar-EG', opts);
    } as unknown as typeof Intl.NumberFormat);
    vi.resetModules();
    const { localDigits } = await import('./format-locale');
    const { currentLocale } = await import('./i18n');
    expect(currentLocale()).toBe('en');
    for (const n of [0, 7, 42, 1234, 1234567, -3, 2.5]) expect(localDigits(n)).toBe(String(n));
  });
});

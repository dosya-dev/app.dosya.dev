import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS, FONT_MAX, FONT_MIN, READER_THEMES, clampFont, isKnownThemeId,
  loadPrefs, resolveTheme, savePrefs, themeById,
} from './readerThemes';

beforeEach(() => localStorage.clear());

describe('reader themes', () => {
  it("keeps mobile's three palettes, and adds the app-matching one", () => {
    // The three fixed palettes still have to match apps/mobile exactly - a book
    // in Sepia should look the same whichever client opens it. `app` is
    // deliberately extra and web/desktop-only: a phone reader has no
    // surrounding app chrome to match, and mobile has its own theme sheet.
    expect(READER_THEMES.map((t) => t.id)).toEqual(['app', 'light', 'sepia', 'dark']);
  });

  it('falls back to the default theme for an unknown id', () => {
    expect(themeById('chartreuse').id).toBe('app');
  });

  it('knows which ids are real', () => {
    expect(isKnownThemeId('sepia')).toBe(true);
    expect(isKnownThemeId('chartreuse')).toBe(false);
  });

  it("uses mobile's sepia paper colour, not an approximation of it", () => {
    expect(themeById('sepia').bg).toBe('#f4ecd8');
  });
});

describe('resolveTheme', () => {
  it('returns a fixed palette verbatim', () => {
    expect(resolveTheme('sepia')).toEqual({ bg: '#f4ecd8', fg: '#5b4636' });
  });

  it('resolves `app` to real colours rather than the empty strings it stores', () => {
    // The stored entry carries no colours on purpose; they come from the DOM.
    const resolved = resolveTheme('app');
    expect(resolved.bg).not.toBe('');
    expect(resolved.fg).not.toBe('');
  });

  it('never hands the reader a transparent background', () => {
    // jsdom resolves no theme variables, which is exactly the degenerate case:
    // painting a book on transparent would make it unreadable.
    expect(resolveTheme('app').bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});

describe('clampFont', () => {
  it('holds the same bounds as mobile, so a book reads at the same size', () => {
    expect(FONT_MIN).toBe(70);
    expect(FONT_MAX).toBe(200);
  });

  it('clamps both ends and rounds', () => {
    expect(clampFont(10)).toBe(FONT_MIN);
    expect(clampFont(500)).toBe(FONT_MAX);
    expect(clampFont(103.6)).toBe(104);
  });
});

describe('prefs', () => {
  it('defaults when nothing is stored', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('round-trips', () => {
    savePrefs({ fontSizePct: 130, themeId: 'sepia' });
    expect(loadPrefs()).toEqual({ fontSizePct: 130, themeId: 'sepia' });
  });

  it('repairs a stored theme that no longer exists', () => {
    // Prefs outlive releases; a theme removed in a later version must not leave
    // the reader with no colours at all.
    localStorage.setItem('dosya.reader.prefs', JSON.stringify({ fontSizePct: 100, themeId: 'chartreuse' }));
    expect(loadPrefs().themeId).toBe('app');
  });

  it('clamps a stored font size that is out of range', () => {
    localStorage.setItem('dosya.reader.prefs', JSON.stringify({ fontSizePct: 9000, themeId: 'light' }));
    expect(loadPrefs().fontSizePct).toBe(FONT_MAX);
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem('dosya.reader.prefs', 'not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});

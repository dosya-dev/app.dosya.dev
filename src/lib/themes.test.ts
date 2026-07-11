import { describe, it, expect } from 'vitest';
import { THEMES, THEME_IDS, isThemeId, isMode, DEFAULT_THEME, DEFAULT_MODE } from './themes';

describe('theme registry', () => {
  it('ships exactly 8 themes including default', () => {
    expect(THEMES).toHaveLength(8);
    expect(THEME_IDS).toContain('default');
  });
  it('has unique, kebab-case ids', () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
    for (const id of THEME_IDS) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });
  it('every theme has a label and a 3-colour swatch', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.swatch.bg).toBeTruthy();
      expect(t.swatch.primary).toBeTruthy();
      expect(t.swatch.accent).toBeTruthy();
    }
  });
  it('validates ids and modes', () => {
    expect(isThemeId('ocean')).toBe(true);
    expect(isThemeId('nope')).toBe(false);
    expect(isMode('system')).toBe(true);
    expect(isMode('sepia')).toBe(false);
    expect(DEFAULT_THEME).toBe('default');
    expect(DEFAULT_MODE).toBe('system');
  });
});

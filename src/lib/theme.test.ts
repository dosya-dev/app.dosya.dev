import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTheme, resolveDark, readCache, writeCache } from './theme';

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: dark, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.classList.remove('dark');
  mockMatchMedia(false);
});

describe('applyTheme', () => {
  it('sets data-theme + dark class for a non-default dark theme', () => {
    applyTheme({ theme: 'ocean', mode: 'dark' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('ocean');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
  it('removes data-theme for the default light theme', () => {
    applyTheme({ theme: 'ocean', mode: 'dark' });
    applyTheme({ theme: 'default', mode: 'light' });
    expect(document.documentElement.getAttribute('data-theme')).toBe(null);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('resolveDark', () => {
  it('follows the OS when mode is system', () => {
    mockMatchMedia(true);
    expect(resolveDark('system')).toBe(true);
    mockMatchMedia(false);
    expect(resolveDark('system')).toBe(false);
  });
  it('honours explicit modes regardless of OS', () => {
    mockMatchMedia(true);
    expect(resolveDark('light')).toBe(false);
    expect(resolveDark('dark')).toBe(true);
  });
});

describe('cache', () => {
  it('round-trips a preference', () => {
    writeCache({ theme: 'amber', mode: 'dark' });
    expect(readCache()).toEqual({ theme: 'amber', mode: 'dark' });
  });
  it('falls back to defaults when empty', () => {
    expect(readCache()).toEqual({ theme: 'default', mode: 'system' });
  });
  it('migrates a legacy theme=dark key', () => {
    localStorage.setItem('theme', 'dark');
    expect(readCache()).toEqual({ theme: 'default', mode: 'dark' });
  });
});

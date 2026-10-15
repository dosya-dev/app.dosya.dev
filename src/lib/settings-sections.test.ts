// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_SECTIONS, sectionFromHash } from './settings-sections';

describe('settings sections', () => {
  it('parses #section-<id> hashes and rejects anything else', () => {
    expect(sectionFromHash('#section-security')).toBe('security');
    expect(sectionFromHash('#section-nope')).toBeNull();
    expect(sectionFromHash('')).toBeNull();
    expect(sectionFromHash('#security')).toBeNull();
  });
  it('every section has a matching <section id> in the settings page', () => {
    const page = readFileSync(new URL('../pages/settings.tsx', import.meta.url), 'utf8');
    for (const s of SETTINGS_SECTIONS) expect(page).toContain(`id="section-${s.id}"`);
  });
});

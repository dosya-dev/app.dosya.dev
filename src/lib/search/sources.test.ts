// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goToItems, integrationItems, visibleItems } from './sources';
import { INTEGRATIONS } from '@/lib/integrations';
import { NAV as PROFILE_NAV } from '@/pages/profile/shared';
import { SETTINGS_SECTIONS } from '@/lib/settings-sections';

const routerSrc = readFileSync(new URL('../../router.tsx', import.meta.url), 'utf8');
const routePatterns = [...routerSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);

function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0];
  return routePatterns.some((p) => {
    const re = new RegExp('^' + p.replace(/\/:[^/]+\?/g, '(?:/[^/]+)?').replace(/:[^/]+/g, '[^/]+') + '$');
    return re.test(path);
  });
}

describe('search sources', () => {
  it('every Go to and integration href resolves to a route in router.tsx', () => {
    for (const i of [...goToItems(), ...integrationItems()]) expect(routeExists(i.href), i.href).toBe(true);
  });
  it('covers every profile section, every settings section and every integration', () => {
    const hrefs = new Set(goToItems().map((i) => i.href));
    for (const n of PROFILE_NAV) expect(hrefs.has(`/profile/${n.id}`), n.id).toBe(true);
    for (const s of SETTINGS_SECTIONS) expect(hrefs.has(`/settings#section-${s.id}`), s.id).toBe(true);
    expect(integrationItems().map((i) => i.id)).toEqual(INTEGRATIONS.map((i) => `integration:${i.slug}`));
  });
  it('ids are unique', () => {
    const ids = [...goToItems(), ...integrationItems()].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('hides perm-gated items the role lacks and keeps ungated ones', () => {
    const can = (p: string) => p !== 'access_settings';
    const ids = visibleItems(goToItems(), can).map((i) => i.id);
    expect(ids).not.toContain('goto:settings');
    expect(ids).not.toContain('goto:settings/security');
    expect(ids).toContain('goto:billing');
    expect(ids).toContain('goto:profile/password');
  });
  it('carries synonyms for the common lookups', () => {
    const kw = (id: string) => goToItems().find((i) => i.id === id)?.keywords ?? [];
    expect(kw('goto:profile/password')).toEqual(expect.arrayContaining(['password', '2fa', 'two-factor']));
    expect(kw('goto:billing')).toEqual(expect.arrayContaining(['invoice', 'plan', 'subscription']));
    expect(kw('goto:trash')).toEqual(expect.arrayContaining(['deleted', 'restore']));
    expect(integrationItems().find((i) => i.id === 'integration:sftp')?.keywords).toContain('ftp');
  });
});

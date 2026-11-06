import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider, loadMessages } from '@/lib/i18n';
import { draftFromKey, type ApiKey } from './api-keys';

const key = (name: string): ApiKey => ({
  id: 'k', name, scope: 'full', key_prefix: 'abcd', created_at: 0,
  last_used_at: null, expires_at: null, s3_access_key_id: null, surfaces: null,
  workspace_id: null, root_folder_id: null, allowed_ips: null, active_hours: null,
});

const switchTo = async (l: 'en' | 'ar' | 'he' | 'fa') => {
  const messages = await loadMessages(l);
  const r = createRoot(document.createElement('div'));
  await act(async () => { r.render(<I18nProvider initial={l} initialMessages={messages}><span /></I18nProvider>); });
  act(() => r.unmount());
};

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

afterEach(() => switchTo('en'));

describe('draftFromKey in a right-to-left language', () => {
  it('pre-fills a copy name without invisible direction marks', async () => {
    for (const l of ['ar', 'he', 'fa'] as const) {
      await switchTo(l);
      const name = draftFromKey(key('MyKey (CI)')).name;
      expect(name, l).toContain('MyKey (CI)');
      expect(name, l).not.toMatch(/[\u200E\u200F\u2066-\u2069]/);
    }
  });

  it('cuts a long name at 64 visible characters', async () => {
    await switchTo('ar');
    const name = draftFromKey(key('x'.repeat(70))).name;
    expect(name).not.toMatch(/[\u2066-\u2069]/);
    expect(name.length).toBe(64);
  });

  it('English stays "<name> copy"', async () => {
    await switchTo('en');
    expect(draftFromKey(key('MyKey')).name).toBe('MyKey copy');
  });
});

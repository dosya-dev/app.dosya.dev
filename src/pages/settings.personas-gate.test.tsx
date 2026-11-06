// Personas settings are each member's own and live on /personas/settings, so
// workspace Settings (which needs access_settings) has no Personas entry or
// section, and asks no Personas route.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, API_BASE: '', api: (...args: unknown[]) => apiMock(...args) };
});

vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));

const SettingsPage = (await import('@/pages/settings')).default;
const { fakeHost } = await import('@/lib/personas-device/__fixtures__/fake-host');
const { useWorkspace } = await import('@/stores/workspace');

function table(): Record<string, unknown> {
  return {
    '/api/workspaces/ws1': {
      ok: true,
      workspace: { id: 'ws1', name: 'Family photos', icon_initials: 'FP', icon_color: '#123456', icon_image_url: null, default_region: 'weur', plan: 'pro', storage_used_bytes: 0 },
      settings: {
        max_file_size_gb: 5, max_storage_per_member_gb: 50, max_total_storage_gb: 100, max_concurrent_uploads: 5,
        allowed_extensions: null, blocked_extensions: null, ip_allowlist: null, ip_blocklist: null,
        country_allowlist: null, country_blocklist: null, allowed_email_domains: null, available_regions: null,
        session_timeout_minutes: 30, download_rate_limit: null, disable_share_links: 0, force_share_password: 0,
        share_max_expiry_days: 7, default_share_expiry_days: null, require_2fa: 0, disable_password_login: 0, record_upload_origin: 1,
      },
      is_owner: true, plan: 'pro', plan_limits: { storage_gb: 200 }, allocation: { plan_gb: 200, allocated_gb: 0, remaining_gb: 200 },
    },
    '/api/roles': { ok: true, roles: [] },
    '/api/team': { ok: true, members: [] },
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { useWorkspace.setState({ activeId: 'ws1' }); fakeHost.reset({ state: 'off' }); });
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
  apiMock.mockReset();
});

async function show() {
  const t = table();
  apiMock.mockImplementation(async (path: string) => {
    const key = path.split('?')[0];
    return key in t ? t[key] : { ok: true };
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(<QueryClientProvider client={qc}><MemoryRouter><SettingsPage /></MemoryRouter></QueryClientProvider>);
  });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const navLabels = () => [...container!.querySelectorAll('nav button')].map((b) => b.textContent?.trim());
const personasCalls = () => apiMock.mock.calls.filter(([p]) => String(p).includes('personas')).length;

describe('Workspace Settings without Personas', () => {
  it('has no Personas nav entry or section, and no Personas request', async () => {
    await show();
    expect(navLabels()).toContain('AI search');
    expect(navLabels()).not.toContain('Personas');
    expect(container!.querySelector('#section-personas')).toBeNull();
    expect(container!.querySelector('button[role="switch"][aria-label="Personas in this workspace"]')).toBeNull();
    expect(personasCalls()).toBe(0);
  });
});

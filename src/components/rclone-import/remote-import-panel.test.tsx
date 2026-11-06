import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { RcloneBackendsResponse, RcloneJob } from '@/api/rclone-import';

const getBackendsMock = vi.fn();
const listJobsMock = vi.fn();
const cancelJobMock = vi.fn();
vi.mock('@/api/rclone-import', async (orig) => ({
  ...(await orig<typeof import('@/api/rclone-import')>()),
  getBackends: (...a: unknown[]) => getBackendsMock(...a),
  listJobs: (...a: unknown[]) => listJobsMock(...a),
  cancelJob: (...a: unknown[]) => cancelJobMock(...a),
}));
vi.mock('@/stores/workspace', () => ({ useWorkspace: (sel: (s: { activeId: string }) => unknown) => sel({ activeId: 'ws_1' }) }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { RemoteImportPanel } = await import('./remote-import-panel');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); }
async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(MemoryRouter, null, createElement(RemoteImportPanel))); await flush(); });
  return container;
}

const ent = (over: Partial<NonNullable<RcloneBackendsResponse['entitlement']>> = {}) => ({
  allowed: true, reason: 'ok' as const, plan: 'plus', trial: false, concurrent: 1, running: 0,
  bytes_limit: 500 * 2 ** 30, bytes_used: 0, bytes_remaining: 500 * 2 ** 30, owner_is_you: true, ...over,
});
const opt = (name: string, password = false) => ({
  name, help: '', type: 'string', required: false, password, sensitive: password, default: '',
});
const meta = (e: ReturnType<typeof ent> | null): RcloneBackendsResponse => ({
  enabled: true, entitlement: e,
  backends: [{ name: 'sftp', label: 'SFTP', description: '', category: 'server', oauth: false, options: [opt('host'), opt('user'), opt('pass', true)] }],
});
const job = (over: Partial<RcloneJob> = {}): RcloneJob => ({
  id: 'rcj_1', workspace_id: 'ws_1', kind: 'import', backend: 'sftp', label: 'SFTP', source_path: '/data', source_host: 'files.example.com',
  dest_folder_id: null, status: 'running', cancel_requested: 0, bytes_total: 100, bytes_done: 50,
  files_total: 4, files_done: 2, files_failed: 0, error_code: null, error_message: null, created_at: 0, finished_at: null, ...over,
});

beforeEach(() => { getBackendsMock.mockReset(); listJobsMock.mockReset().mockResolvedValue([]); cancelJobMock.mockReset().mockResolvedValue({}); });
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

describe('RemoteImportPanel', () => {
  it('says "not available yet" while the feature is off', async () => {
    getBackendsMock.mockResolvedValue({ enabled: false, backends: [], entitlement: null });
    const c = await render();
    expect(c.textContent).toContain('available for your account yet');
    expect(c.textContent).not.toContain('New import');
  });

  it('free plan: what they would unlock and an upgrade link, no wizard', async () => {
    getBackendsMock.mockResolvedValue(meta(ent({ allowed: false, reason: 'free_plan', plan: 'free' })));
    const c = await render();
    expect(c.textContent).toContain('services supported');
    expect(c.querySelector('a[href="/billing"]')).not.toBeNull();
    expect(c.textContent).not.toContain('New import');
  });

  it('paid: the wizard, the service tiles and the monthly meter', async () => {
    getBackendsMock.mockResolvedValue(meta(ent({ bytes_used: 2 ** 30 })));
    const c = await render();
    expect(c.textContent).toContain('New import');
    expect(c.textContent).toContain('This month');
    expect(c.querySelector('[role="meter"]')).not.toBeNull();
    expect([...c.querySelectorAll('button')].some((b) => b.textContent?.includes('SFTP'))).toBe(true);
  });

  it('choosing a service opens its connection step inline', async () => {
    getBackendsMock.mockResolvedValue(meta(ent()));
    const c = await render();
    const tile = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('SFTP'))!;
    await act(async () => { tile.click(); await flush(); });
    expect(c.textContent).toContain('Test connection');
    expect(c.textContent).toContain('Change');
  });

  it('never autofills the saved dosya login into a service form', async () => {
    getBackendsMock.mockResolvedValue(meta(ent()));
    const c = await render();
    const tile = [...c.querySelectorAll('button')].find((b) => b.textContent?.includes('SFTP'))!;
    await act(async () => { tile.click(); await flush(); });
    const pass = c.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(pass.autocomplete).toBe('new-password');
    expect(pass.dataset.lpignore).toBe('true');
    const user = c.querySelector<HTMLInputElement>('#rclone-opt-user')!;
    expect(user.autocomplete).toBe('off');
    expect(user.hasAttribute('data-1p-ignore')).toBe(true);
  });

  it('trial: the trial meter', async () => {
    getBackendsMock.mockResolvedValue(meta(ent({ trial: true, bytes_limit: 15 * 2 ** 30 })));
    expect((await render()).textContent).toContain('Trial allowance');
  });

  it('lists jobs and cancels a running one', async () => {
    getBackendsMock.mockResolvedValue(meta(ent()));
    listJobsMock.mockResolvedValue([job(), job({ id: 'rcj_2', status: 'failed', error_message: 'Auth failed' })]);
    const c = await render();
    expect(c.querySelectorAll('[data-testid="rclone-job"]')).toHaveLength(2);
    // The raw rclone text sits behind Details, with a plain reason up front.
    expect(c.textContent).toContain("Couldn't connect or copy");
    expect(c.textContent).not.toContain('Auth failed');
    const details = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Details')!;
    await act(async () => { details.click(); await flush(); });
    expect(c.textContent).toContain('Auth failed');
    const cancel = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    await act(async () => { cancel.click(); await flush(); });
    expect(cancelJobMock).toHaveBeenCalledWith('rcj_1');
  });
});

describe('/integrations directory card', () => {
  it('appears only when the API says remote import is on', async () => {
    const { default: IntegrationsPage } = await import('@/pages/integrations');
    const renderDir = async () => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => { root!.render(createElement(MemoryRouter, null, createElement(IntegrationsPage))); await flush(); });
      return container;
    };
    getBackendsMock.mockResolvedValue({ enabled: false, backends: [], entitlement: null });
    expect((await renderDir()).querySelector('a[href="/integrations/remote-rclone"]')).toBeNull();
    act(() => root?.unmount()); container?.remove();
    getBackendsMock.mockResolvedValue(meta(ent()));
    expect((await renderDir()).querySelector('a[href="/integrations/remote-rclone"]')).not.toBeNull();
  });
});

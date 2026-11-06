import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock('@/lib/personas-device/engine-host', () => import('@/lib/personas-device/__fixtures__/fake-host'));

const { fakeHost } = await import('@/lib/personas-device/__fixtures__/fake-host');
const { default: PersonasSettingsPage } = await import('./settings-page');
const { useWorkspace } = await import('@/stores/workspace');

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
beforeEach(() => {
  fakeHost.reset();
  useWorkspace.setState({ activeId: 'ws1' });
  apiMock.mockReset();
  apiMock.mockResolvedValue({ ok: true });
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null; container = null;
});

describe('/personas/settings', () => {
  it('is a route of its own, gated like /personas (every member who may see files)', () => {
    const router = readFileSync(resolve(__dirname, '../../router.tsx'), 'utf8');
    expect(router).toMatch(/path: '\/personas\/settings', element: <RequirePermission perm="access_files"><PersonasSettingsPage \/>/);
  });

  it('shows the Personas settings with a way back to the people', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root!.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/personas/settings']}><PersonasSettingsPage /></MemoryRouter></QueryClientProvider>);
    });
    await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
    expect(container.querySelector('h1')!.textContent).toBe('Personas settings');
    expect(container.querySelector('button[role="switch"][aria-label="Personas in this workspace"]')).toBeTruthy();
    expect([...container.querySelectorAll('a[href="/personas"]')].some((a) => a.textContent?.includes('Personas'))).toBe(true);
  });
});

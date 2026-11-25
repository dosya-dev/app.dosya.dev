import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { generateDeviceKeys, renderClientConfig } from '@/lib/vpn-config';

const apiMock = vi.fn();
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

const { default: VpnPage } = await import('./vpn');

const NOW = Math.floor(Date.now() / 1000);
const SERVER_KEY = 'U0VSVkVSUFVCTElDS0VZU0VSVkVSUFVCTElDS0VZQUE=';
const loc = (code: string, country: string, city: string, region: string, status = 'off') =>
  ({ code, country, city, region, hostname: `${code}.vpn.dosya.dev`, port: 51820, status, server_public_key: SERVER_KEY });

function vpnData(over: Record<string, unknown> = {}) {
  return {
    ok: true, entitled: true, reason: 'ok', usage: { usedBytes: 12 * 1_073_741_824, capBytes: 500 * 1_073_741_824 },
    limits: { maxDevices: 5 }, devices: [] as unknown[],
    locations: [loc('de', 'DE', 'Frankfurt', 'europe'), loc('jp', 'JP', 'Tokyo', 'asia_pacific'), loc('br', 'BR', 'São Paulo', 'americas')],
    dns: ['9.9.9.9', '149.112.112.112'],
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let qc: QueryClient;
let current = vpnData();
const calls: Array<{ path: string; init?: RequestInit }> = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const w = window as unknown as { PointerEvent?: typeof MouseEvent; MouseEvent: typeof MouseEvent };
  if (!w.PointerEvent) w.PointerEvent = w.MouseEvent;
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  apiMock.mockReset();
  calls.length = 0;
  localStorage.clear();
  document.body.innerHTML = '';
});

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function render(data = vpnData(), startStatus = 'booting') {
  current = data;
  apiMock.mockImplementation(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    if (path === '/api/vpn') return current;
    if (path === '/api/vpn/devices') {
      const body = JSON.parse(String(init?.body));
      const device = { id: 'vpd_new', name: body.name, platform: body.platform, public_key: body.public_key, address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null };
      return { ok: true, device };
    }
    if (path.endsWith('/start')) return { ok: true, status: startStatus };
    if (init?.method === 'DELETE') return { ok: true };
    return { ok: true };
  });
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<QueryClientProvider client={qc}><MemoryRouter><VpnPage /></MemoryRouter></QueryClientProvider>);
  });
  await flush();
}

const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
async function click(el: Element | undefined) {
  expect(el, 'element to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function refetch(next: ReturnType<typeof vpnData>) {
  current = next;
  await act(async () => { await qc.invalidateQueries(); });
  await flush();
}

describe('VPN page', () => {
  it('a free user sees the upgrade card, the locations, and no way to add devices or start servers', async () => {
    await render(vpnData({ entitled: false, reason: 'free_plan' }));
    expect(document.querySelector('[data-testid="vpn-upgrade"]')?.textContent).toContain("included with dosya's paid plans");
    expect(button('Add a device')).toBeUndefined();
    expect(button('Start')).toBeUndefined();
    expect(text()).toContain('Frankfurt');
  });

  it('a user whose payment lapsed still sees their devices and can remove them, but cannot start or add', async () => {
    await render(vpnData({ entitled: false, reason: 'grace_period', devices: [{ id: 'd1', name: 'Old Phone', platform: 'ios', public_key: 'K', address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null }] }));
    expect(text()).toContain('Old Phone');
    expect(button('Remove')).toBeTruthy();
    expect(button('Start')).toBeUndefined();
    expect(button('Add a device')).toBeUndefined();
    expect(button('Get profiles')).toBeUndefined();
  });

  it('groups locations by region from the API', async () => {
    await render();
    const headings = [...document.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Europe', 'Americas', 'Asia-Pacific']);
  });

  it('adding a device sends only the public key; the private key never leaves the page', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await render();
    await click(button('Add a device'));
    await type(document.body.querySelector('[role="dialog"] input') as HTMLInputElement, "Firat's iPhone");
    await click(button('Create'));
    await flush(10);

    const post = calls.find((c) => c.path === '/api/vpn/devices')!;
    const body = JSON.parse(String(post.init?.body));
    expect(Object.keys(body).sort()).toEqual(['name', 'platform', 'public_key']);
    expect(body).toMatchObject({ name: "Firat's iPhone", platform: 'ios' });
    expect(text()).toContain("We can't show this again.");
    expect(button('Download all 3 locations')).toBeTruthy();
    expect(document.querySelector('[data-testid="vpn-qr"] img')).toBeTruthy();

    // The private key appears in the QR (the profile) but in no request and no storage.
    const qr = decodeURIComponent((document.querySelector('[data-testid="vpn-qr"] img') as HTMLImageElement).src);
    expect(qr.length).toBeGreaterThan(100);
    for (const c of calls) {
      expect(c.path).not.toMatch(/PrivateKey/);
      expect(String(c.init?.body ?? '')).not.toMatch(/private/i);
    }
    for (const [, v] of setItem.mock.calls) expect(String(v)).not.toMatch(/[A-Za-z0-9+/]{43}=/);
    setItem.mockRestore();
  });

  it('after a reload: a .conf with the device key gives every profile, with no new device; another key is refused', async () => {
    const keys = await generateDeviceKeys();
    const device = { id: 'd1', name: 'Laptop', platform: 'macos', public_key: keys.publicKey, address_v4: '10.200.0.5', address_v6: 'fd5a:d05a::5', created_at: NOW, last_handshake_at: null };
    await render(vpnData({ devices: [device] }));
    await click(button('Get profiles'));

    const input = document.querySelector('[data-testid="vpn-conf-input"]') as HTMLInputElement;
    const other = await generateDeviceKeys();
    const wrong = renderClientConfig({ privateKey: other.privateKey, addressV4: '10.200.0.5', addressV6: 'fd5a:d05a::5', dns: [], serverPublicKey: SERVER_KEY, hostname: 'x', port: 1 });
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([wrong], 'old.conf')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush(10);
    expect(text()).toContain('This file belongs to a different device.');

    const right = renderClientConfig({ privateKey: keys.privateKey, addressV4: '10.200.0.5', addressV6: 'fd5a:d05a::5', dns: [], serverPublicKey: SERVER_KEY, hostname: 'x', port: 1 });
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([right], 'dosya-de.conf')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush(10);
    expect(button('Download all 3 locations')).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/vpn/devices')).toBe(false);
  });

  it('connect guide: Start → starting → ready → a device connects', async () => {
    const dev = { id: 'd1', name: "Firat's iPhone", platform: 'ios', public_key: 'K', address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null as number | null };
    await render(vpnData({ devices: [dev] }));
    expect(text()).toContain('Press Start on a location to connect.');

    await click(document.querySelector('[data-testid="vpn-location-de"] button') as HTMLButtonElement);
    expect(calls.some((c) => c.path === '/api/vpn/locations/de/start')).toBe(true);
    await refetch(vpnData({ devices: [dev], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'booting')] }));
    expect(text()).toContain('Starting your server in Germany');

    await refetch(vpnData({ devices: [dev], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'up')] }));
    expect(text()).toContain('Ready: turn the tunnel on in the WireGuard app.');

    await refetch(vpnData({ devices: [{ ...dev, last_handshake_at: Math.floor(Date.now() / 1000) + 5 }], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'up')] }));
    expect(text()).toContain("Connected: Firat's iPhone");
  });

  it('a "servers busy" Start reply shows at once and does not keep asking', async () => {
    const dev = { id: 'd1', name: 'P', platform: 'ios', public_key: 'K', address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null };
    await render(vpnData({ devices: [dev] }), 'capacity');
    await click(document.querySelector('[data-testid="vpn-location-jp"] button') as HTMLButtonElement);
    expect(text()).toContain('All of our VPN servers are busy right now.');
    await refetch(vpnData({ devices: [dev] }));
    expect(calls.filter((c) => c.path === '/api/vpn/locations/jp/start')).toHaveLength(1);
  });

  it('Try again after a failed start shows Starting, not the cached failure', async () => {
    const dev = { id: 'd1', name: 'P', platform: 'ios', public_key: 'K', address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null };
    await render(vpnData({ devices: [dev], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'failed')] }), 'booting');
    // The page's cache still holds "failed"; the server, having accepted the
    // start, reports "booting" from now on, as the real API does. Without this
    // the refetch after Start answered "failed" too, and the result depended on
    // whether it landed inside click()'s fixed flush (it did on 2-core CI).
    current = vpnData({ devices: [dev], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'booting')] });
    await click(document.querySelector('[data-testid="vpn-location-de"] button') as HTMLButtonElement);
    expect(text()).not.toContain("We couldn't start Germany");
    await refetch(vpnData({ devices: [dev], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'booting')] }));
    expect(text()).toContain('Starting your server in Germany');
  });

  it("I've scanned it starts the shown location and watches the new device", async () => {
    await render();
    await click(button('Add a device'));
    await type(document.body.querySelector('[role="dialog"] input') as HTMLInputElement, 'Tablet');
    await click(button('Create'));
    await flush(10);
    await click(button("I've scanned it"));
    expect(calls.some((c) => c.path === '/api/vpn/locations/de/start')).toBe(true);
    const tablet = { id: 'vpd_new', name: 'Tablet', platform: 'ios', public_key: 'K', address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null as number | null };
    const laptop = { ...tablet, id: 'd9', name: 'Laptop', last_handshake_at: NOW };
    await refetch(vpnData({ devices: [tablet, laptop], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'up')] }));
    await refetch(vpnData({ devices: [tablet, { ...laptop, last_handshake_at: NOW + 50 }], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'up')] }));
    expect(text()).not.toContain('Connected: Laptop');
    await refetch(vpnData({ devices: [{ ...tablet, last_handshake_at: NOW + 60 }, laptop], locations: [loc('de', 'DE', 'Frankfurt', 'europe', 'up')] }));
    expect(text()).toContain('Connected: Tablet');
  });

  it('a browser that cannot make the key says so instead of freezing', async () => {
    const spy = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('NotSupportedError'));
    await render();
    await click(button('Add a device'));
    await type(document.body.querySelector('[role="dialog"] input') as HTMLInputElement, 'Old browser');
    await click(button('Create'));
    expect(text()).toContain("This browser can't make a VPN key.");
    expect(button('Create')?.disabled).toBe(false);
    spy.mockRestore();
  });

  it('clicking outside the QR step does not throw the key away', async () => {
    await render();
    await click(button('Add a device'));
    await type(document.body.querySelector('[role="dialog"] input') as HTMLInputElement, 'Phone');
    await click(button('Create'));
    await flush(10);
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement | null;
    await act(async () => {
      backdrop?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      backdrop?.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(text()).toContain("We can't show this again.");
  });

  it('a refused start shows why (no device / start limit)', async () => {
    await render();
    apiMock.mockImplementation(async (path: string) => {
      if (path.endsWith('/start')) {
        const { ApiError } = await import('@/api/client');
        throw new ApiError(429, JSON.stringify({ ok: false, error: 'x', reason: 'start_limit' }));
      }
      return current;
    });
    await click(document.querySelector('[data-testid="vpn-location-jp"] button') as HTMLButtonElement);
    expect(text()).toContain("You've started a lot of locations recently.");
  });

  it('opening the page pre-warms the last-used location quietly: no guide, no hints', async () => {
    localStorage.setItem('dosya.vpn.lastLocation', 'jp');
    await render(vpnData({ devices: [{ id: 'd1', name: 'P', platform: 'ios', public_key: 'K', address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2', created_at: NOW, last_handshake_at: null }] }));
    expect(calls.some((c) => c.path === '/api/vpn/locations/jp/start')).toBe(true);
    expect(text()).toContain('Press Start on a location to connect.');
  });

  it('no pre-warm without a device', async () => {
    localStorage.setItem('dosya.vpn.lastLocation', 'jp');
    await render();
    expect(calls.some((c) => c.path.endsWith('/start'))).toBe(false);
  });
});

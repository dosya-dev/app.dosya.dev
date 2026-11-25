import type { components } from '@dosya-dev/vpn-contract';
import { api, ApiError } from '@/api/client';

/**
 * Typed calls for the VPN routes. Types are generated from
 * packages/vpn-contract (vendored into apps/web/vendor/vpn-contract), so the
 * page and the API cannot drift apart silently.
 */

export type VpnStatus = components['schemas']['VpnStatus'];
export type VpnDevice = components['schemas']['Device'];
export type VpnLocation = components['schemas']['Location'];
export type VpnPlatform = 'config' | 'ios' | 'android' | 'macos' | 'windows' | 'linux';

/** A refusal: the human message plus the machine reason (open enum). */
export interface VpnFailure { ok: false; error: string; reason?: string; status: number }

async function call<T>(path: string, init?: RequestInit): Promise<T | VpnFailure> {
  try {
    return await api<T>(path, init);
  } catch (e) {
    if (e instanceof ApiError) {
      try {
        const body = JSON.parse(e.body) as { error?: string; reason?: string };
        return { ok: false, error: body.error ?? e.message, reason: body.reason, status: e.status };
      } catch { /* not json */ }
      return { ok: false, error: e.body || e.message, status: e.status };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: 0 };
  }
}

export const isFailure = (r: unknown): r is VpnFailure => !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === false;

export const getVpn = () => call<VpnStatus>('/api/vpn');

export const createDevice = (name: string, publicKey: string, platform: VpnPlatform) =>
  call<components['schemas']['DeviceCreated']>('/api/vpn/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, public_key: publicKey, platform }),
  });

export const deleteDevice = (id: string) => call<{ ok: true }>(`/api/vpn/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const startLocation = (code: string) =>
  call<components['schemas']['StartResult']>(`/api/vpn/locations/${encodeURIComponent(code)}/start`, { method: 'POST' });

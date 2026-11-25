/**
 * WireGuard profiles for Dosya VPN, made entirely in the browser.
 *
 * The device's private key is generated here with WebCrypto X25519 and never
 * leaves this page: only the public half is sent to the API. Every value in a
 * profile (addresses, DNS, server key, hostname, port) comes from GET /api/vpn.
 */

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const b64urlToB64 = (s: string) => s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
const WG_KEY = /^[A-Za-z0-9+/]{43}=$/;

export async function generateDeviceKeys(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { privateKey: b64urlToB64(jwk.d!), publicKey: b64(pub) };
}

/** The public key for a WireGuard private key (d·G with G = 9), used to match an imported profile to its device. */
export async function publicKeyFor(privateKey: string): Promise<string> {
  const raw = Uint8Array.from(atob(privateKey), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('not a WireGuard private key');
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20, ...raw]);
  const priv = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  const g = new Uint8Array(32);
  g[0] = 9;
  const base = await crypto.subtle.importKey('raw', g, { name: 'X25519' }, false, []);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: base } as unknown as AlgorithmIdentifier, priv, 256)));
}

export interface ProfileInput {
  privateKey: string;
  addressV4: string;
  addressV6: string;
  dns: string[];
  serverPublicKey: string;
  hostname: string;
  port: number;
}

export function renderClientConfig(p: ProfileInput): string {
  return [
    '[Interface]',
    `PrivateKey = ${p.privateKey}`,
    `Address = ${p.addressV4}/32, ${p.addressV6}/128`,
    `DNS = ${p.dns.join(', ')}`,
    '',
    '[Peer]',
    `PublicKey = ${p.serverPublicKey}`,
    'AllowedIPs = 0.0.0.0/0, ::/0',
    `Endpoint = ${p.hostname}:${p.port}`,
    'PersistentKeepalive = 25',
    '',
  ].join('\n');
}

export interface ProfileLocation {
  code: string;
  hostname: string;
  port: number;
  server_public_key: string | null;
}

/** One profile per location (`dosya-<code>.conf`); a location without a server key yet is skipped. */
export function renderAllProfiles(
  privateKey: string, device: { address_v4: string; address_v6: string }, locations: ProfileLocation[], dns: string[],
): Array<{ filename: string; text: string }> {
  return locations.filter((l) => l.server_public_key).map((l) => ({
    filename: `dosya-${l.code}.conf`,
    text: renderClientConfig({
      privateKey, addressV4: device.address_v4, addressV6: device.address_v6, dns,
      serverPublicKey: l.server_public_key!, hostname: l.hostname, port: l.port,
    }),
  }));
}

/** Reads a profile the user picked from their own disk. Nothing is uploaded. */
export function parseLocalConfig(text: string): { privateKey: string; addressV4: string } | null {
  const key = text.match(/^\s*PrivateKey\s*=\s*(\S+)\s*$/m)?.[1];
  const addr = text.match(/^\s*Address\s*=\s*([0-9.]+)\/32/m)?.[1];
  if (!key || !WG_KEY.test(key) || !addr) return null;
  return { privateKey: key, addressV4: addr };
}

// ---- a minimal ZIP writer (stored, no compression): profiles are tiny text files

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: Array<{ filename: string; text: string }>): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.filename);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); // UTF-8 names
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    local.push(new Uint8Array(lh.buffer), name, data);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

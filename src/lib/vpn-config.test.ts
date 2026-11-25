import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateDeviceKeys, publicKeyFor, renderClientConfig, renderAllProfiles, parseLocalConfig, zipFiles,
} from './vpn-config';

const LOC = (code: string, port = 51820) => ({ code, hostname: `${code}.vpn.dosya.dev`, port, server_public_key: 'U0VSVkVSUFVCTElDS0VZU0VSVkVSUFVCTElDS0VZQUE=' });

describe('keys', () => {
  it('generates a WireGuard key pair whose public half matches the private half', async () => {
    const k = await generateDeviceKeys();
    expect(k.privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(k.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(await publicKeyFor(k.privateKey)).toBe(k.publicKey);
  });

  it('two pairs differ', async () => {
    expect((await generateDeviceKeys()).privateKey).not.toBe((await generateDeviceKeys()).privateKey);
  });
});

describe('renderClientConfig', () => {
  it('uses every value from the API, including a non-default port and DNS', () => {
    const conf = renderClientConfig({
      privateKey: 'PRIV=', addressV4: '10.200.0.2', addressV6: 'fd5a:d05a::2', dns: ['9.9.9.9', '149.112.112.112'],
      serverPublicKey: 'SERVERPUB=', hostname: 'de.vpn.dosya.dev', port: 41641,
    });
    expect(conf).toBe([
      '[Interface]', 'PrivateKey = PRIV=', 'Address = 10.200.0.2/32, fd5a:d05a::2/128', 'DNS = 9.9.9.9, 149.112.112.112', '',
      '[Peer]', 'PublicKey = SERVERPUB=', 'AllowedIPs = 0.0.0.0/0, ::/0', 'Endpoint = de.vpn.dosya.dev:41641', 'PersistentKeepalive = 25', '',
    ].join('\n'));
  });
});

describe('renderAllProfiles', () => {
  it('makes one dosya-<code>.conf per location', () => {
    const files = renderAllProfiles('PRIV=', { address_v4: '10.200.0.2', address_v6: 'fd5a:d05a::2' }, [LOC('de'), LOC('jp'), LOC('us-east')], ['9.9.9.9']);
    expect(files.map((f) => f.filename)).toEqual(['dosya-de.conf', 'dosya-jp.conf', 'dosya-us-east.conf']);
    expect(files[1].text).toContain('Endpoint = jp.vpn.dosya.dev:51820');
  });

  it('skips a location that has no server key yet', () => {
    const files = renderAllProfiles('PRIV=', { address_v4: 'a', address_v6: 'b' }, [LOC('de'), { ...LOC('jp'), server_public_key: null }], []);
    expect(files.map((f) => f.filename)).toEqual(['dosya-de.conf']);
  });
});

describe('parseLocalConfig', () => {
  it('reads the private key and addresses from a profile we made', () => {
    const text = renderClientConfig({ privateKey: 'cHJpdmF0ZWtleXByaXZhdGVrZXlwcml2YXRla2V5MTI=', addressV4: '10.200.0.7', addressV6: 'fd5a:d05a::7', dns: [], serverPublicKey: 'S=', hostname: 'h', port: 1 });
    expect(parseLocalConfig(text)).toEqual({ privateKey: 'cHJpdmF0ZWtleXByaXZhdGVrZXlwcml2YXRla2V5MTI=', addressV4: '10.200.0.7' });
  });

  it('returns null for something that is not a WireGuard profile', () => {
    expect(parseLocalConfig('hello')).toBeNull();
    expect(parseLocalConfig('[Interface]\nPrivateKey = not-a-key\n')).toBeNull();
  });
});

describe('zipFiles', () => {
  it('builds a ZIP that a standard unzipper reads back exactly', () => {
    const files = [{ filename: 'dosya-de.conf', text: 'hello de\n' }, { filename: 'dosya-jp.conf', text: 'hello jp ünicode\n' }];
    const bytes = zipFiles(files);
    const dir = mkdtempSync(join(tmpdir(), 'vpnzip-'));
    const path = join(dir, 'p.zip');
    writeFileSync(path, bytes);
    const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))', path]).toString();
    expect(JSON.parse(out)).toEqual({ 'dosya-de.conf': 'hello de\n', 'dosya-jp.conf': 'hello jp ünicode\n' });
  });
});

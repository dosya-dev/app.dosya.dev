import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// apps/web is built on its own (no ../../packages there), so the VPN contract's
// generated types are vendored. In the monorepo, the copy must match the source.
const source = resolve(__dirname, '../../../../packages/vpn-contract/generated/vpn.ts');
const vendored = resolve(__dirname, '../../vendor/vpn-contract/vpn.ts');

describe.skipIf(!existsSync(source))('vendored VPN contract', () => {
  it('matches packages/vpn-contract/generated/vpn.ts (copy it after regenerating)', () => {
    expect(readFileSync(vendored, 'utf8')).toBe(readFileSync(source, 'utf8'));
  });
});

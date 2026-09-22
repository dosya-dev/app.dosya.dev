import { afterEach, describe, expect, it } from 'vitest';
import {
  REDEMPTION_CLAIM_KEY,
  REDEMPTION_PROVIDER_KEY,
  clearRedemptionClaim,
  pendingPostAuthPath,
  readRedemptionClaim,
  readRedemptionProvider,
  rememberRedemptionClaim,
  rememberRedemptionProvider,
} from './redemption-claim';

const CLAIM = 'A'.repeat(40);

afterEach(() => sessionStorage.clear());

describe('redemption claim continuation', () => {
  it('stores only a valid opaque claim in tab-scoped storage', () => {
    expect(rememberRedemptionClaim(CLAIM)).toBe(CLAIM);
    expect(readRedemptionClaim()).toBe(CLAIM);
    expect(sessionStorage.getItem(REDEMPTION_CLAIM_KEY)).toBe(CLAIM);
    expect(rememberRedemptionClaim('too-short')).toBeNull();
    expect(readRedemptionClaim()).toBe(CLAIM);
  });

  it('clears a completed or terminal claim', () => {
    rememberRedemptionClaim(CLAIM);
    clearRedemptionClaim();
    expect(readRedemptionClaim()).toBeNull();
  });

  it('resumes a pending Gumroad redemption after auth, and nothing once it is cleared', () => {
    rememberRedemptionClaim(CLAIM);
    expect(pendingPostAuthPath()).toBe('/redeem');

    clearRedemptionClaim();
    expect(pendingPostAuthPath()).toBeNull();
  });

  it('remembers the provider beside the claim and drops it with the claim', () => {
    expect(readRedemptionProvider()).toBeNull();

    rememberRedemptionProvider('voucher');
    expect(readRedemptionProvider()).toBe('voucher');
    expect(sessionStorage.getItem(REDEMPTION_PROVIDER_KEY)).toBe('voucher');

    rememberRedemptionProvider('gumroad');
    expect(readRedemptionProvider()).toBe('gumroad');

    sessionStorage.setItem(REDEMPTION_PROVIDER_KEY, 'paypal');
    expect(readRedemptionProvider()).toBeNull();

    rememberRedemptionProvider('voucher');
    clearRedemptionClaim();
    expect(readRedemptionProvider()).toBeNull();
  });

  it('never accepts a URL or arbitrary path as a claim', () => {
    expect(rememberRedemptionClaim('https://evil.test/')).toBeNull();
    expect(rememberRedemptionClaim('../billing')).toBeNull();
    expect(pendingPostAuthPath()).toBeNull();
  });
});

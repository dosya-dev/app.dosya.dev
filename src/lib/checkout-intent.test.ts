import { describe, expect, it } from 'vitest';
import { checkoutIntentPath, readBillingIntent } from './checkout-intent';

describe('checkoutIntentPath', () => {
  it('turns the promo page sign-up link into a Billing path', () => {
    const q = new URLSearchParams('plan=tb4&billing=yearly&promo=synology30');
    expect(checkoutIntentPath(q)).toBe('/billing?upgrade=1&plan=tb4&interval=year&promo=SYNOLOGY30');
  });

  it('is null for a plain sign-up link', () => {
    expect(checkoutIntentPath(new URLSearchParams(''))).toBeNull();
    expect(checkoutIntentPath(new URLSearchParams('ref=abc'))).toBeNull();
    expect(checkoutIntentPath(new URLSearchParams('billing=yearly'))).toBeNull();
  });

  it('drops values of the wrong shape instead of passing them on', () => {
    const q = new URLSearchParams('plan=../x&billing=weekly&promo=<script>');
    expect(checkoutIntentPath(q)).toBeNull();
    expect(checkoutIntentPath(new URLSearchParams('plan=free'))).toBeNull();
  });

  it('keeps a code without a plan', () => {
    expect(checkoutIntentPath(new URLSearchParams('promo=NAS30'))).toBe('/billing?upgrade=1&promo=NAS30');
  });
});

describe('readBillingIntent', () => {
  it('reads what checkoutIntentPath wrote', () => {
    const path = checkoutIntentPath(new URLSearchParams('plan=business&billing=monthly&promo=nas30'))!;
    expect(readBillingIntent(path.slice(path.indexOf('?')))).toEqual({ planId: 'business', interval: 'month', promo: 'NAS30' });
  });

  it('is empty for an ordinary Billing visit', () => {
    expect(readBillingIntent('')).toEqual({});
    expect(readBillingIntent('?upgrade=1')).toEqual({});
  });
});

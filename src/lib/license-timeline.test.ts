import { describe, expect, it } from 'vitest';
import { LICENSE_ENDING_SOON_DAYS, licenseIntervalLabel, licenseProviderLabel, licenseTimeline } from './license-timeline';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const NOW = at('2026-09-14T12:00:00Z');

describe('licenseTimeline', () => {
  it('reads as an estimated renewal while the membership renews', () => {
    expect(licenseTimeline({ status: 'active', ends_at: null, renews_at: at('2026-10-10T12:00:00Z') }, NOW))
      .toEqual({ tone: 'renews', badge: 'Active', text: 'Renews around Oct 10, 2026' });
  });

  it('falls back to Gumroad when no renewal can be estimated', () => {
    expect(licenseTimeline({ status: 'active', ends_at: null, renews_at: null }, NOW).text).toBe('Renews through Gumroad');
  });

  it('flags a cancelled membership with its end date', () => {
    expect(licenseTimeline({ status: 'active', ends_at: at('2026-12-01T12:00:00Z'), renews_at: null }, NOW))
      .toEqual({ tone: 'ending', badge: 'Ending', text: 'Ends Dec 1, 2026' });
  });

  it('says ended once the end date has passed, even before the daily check flips status', () => {
    expect(licenseTimeline({ status: 'active', ends_at: at('2026-09-01T12:00:00Z') }, NOW))
      .toMatchObject({ tone: 'ended', text: 'Ended Sep 1, 2026' });
    expect(licenseTimeline({ status: 'ended', ends_at: null }, NOW).text).toBe('Membership ended on Gumroad');
  });

  it('explains a revoked package', () => {
    expect(licenseTimeline({ status: 'revoked', ends_at: null }, NOW))
      .toEqual({ tone: 'revoked', badge: 'Revoked', text: 'Refunded or disputed on Gumroad' });
  });
});

describe('licenseIntervalLabel', () => {
  it('labels every stored interval and tolerates unknown values', () => {
    expect(licenseIntervalLabel('two_years')).toBe('Every 2 years');
    expect(licenseIntervalLabel(null)).toBe('Recurring');
    expect(licenseIntervalLabel('fortnight')).toBe('Recurring');
  });
});

describe('provider-aware license wording', () => {
  it('labels providers for people', () => {
    expect(licenseProviderLabel('gumroad')).toBe('Gumroad');
    expect(licenseProviderLabel('voucher')).toBe('Coupon code');
    expect(licenseProviderLabel(undefined)).toBe('Gumroad');
  });

  it('names an unknown provider as a redeemed code rather than printing its raw value', () => {
    expect(licenseProviderLabel('partner_bundle')).toBe('Redeemed code');
  });

  it('does not blame Gumroad for an ended or revoked coupon grant', () => {
    expect(licenseTimeline({ status: 'ended', ends_at: null, provider: 'voucher' }, 100).text).toBe('Ended');
    expect(licenseTimeline({ status: 'revoked', ends_at: null, provider: 'voucher' }, 100).text).toBe('Revoked');
    expect(licenseTimeline({ status: 'ended', ends_at: null, provider: 'gumroad' }, 100).text).toBe('Membership ended on Gumroad');
  });

  it('keeps the plain end date for a coupon grant', () => {
    const t = licenseTimeline({ status: 'active', ends_at: 200, provider: 'voucher' }, 100);
    expect(t.tone).toBe('ending');
    expect(t.text).toMatch(/^Ends /);
  });

  it('reads Active while a coupon grant is still months from its end date', () => {
    // Every coupon grant carries an end date, so "Ending" from the day it is
    // redeemed would paint 90 days of amber on a package that is simply active.
    expect(licenseTimeline({ status: 'active', ends_at: at('2026-12-13T12:00:00Z'), provider: 'voucher' }, NOW))
      .toEqual({ tone: 'renews', badge: 'Active', text: 'Ends Dec 13, 2026' });
    expect(LICENSE_ENDING_SOON_DAYS).toBe(14);
  });

  it('warns that a coupon grant is ending once it is inside the last two weeks', () => {
    expect(licenseTimeline({ status: 'active', ends_at: at('2026-09-21T12:00:00Z'), provider: 'voucher' }, NOW))
      .toEqual({ tone: 'ending', badge: 'Ending', text: 'Ends Sep 21, 2026' });
  });

  it('leaves a cancelled Gumroad membership reading Ending however far off its end date is', () => {
    expect(licenseTimeline({ status: 'active', ends_at: at('2026-12-13T12:00:00Z'), provider: 'gumroad' }, NOW))
      .toEqual({ tone: 'ending', badge: 'Ending', text: 'Ends Dec 13, 2026' });
  });

  it('says a never-ending coupon grant does not end, rather than naming Gumroad', () => {
    expect(licenseTimeline({ status: 'active', ends_at: null, renews_at: null, provider: 'voucher' }, 100))
      .toEqual({ tone: 'renews', badge: 'Active', text: 'Does not end' });
  });

  it('still reads Renews through Gumroad for a never-ending Gumroad membership', () => {
    expect(licenseTimeline({ status: 'active', ends_at: null, renews_at: null, provider: 'gumroad' }, 100).text)
      .toBe('Renews through Gumroad');
  });
});

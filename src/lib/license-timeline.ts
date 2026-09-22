// One wording for redeemed-license dates, shared by billing and the workspace
// dashboard so a package never reads "Active" in one place and "Ending" in another.

export type LicenseIntervalValue = 'month' | 'quarter' | 'half_year' | 'year' | 'two_years' | 'unknown';

export const LICENSE_INTERVAL_LABELS: Record<LicenseIntervalValue, string> = {
  month: 'Monthly',
  quarter: 'Quarterly',
  half_year: 'Every 6 months',
  year: 'Yearly',
  two_years: 'Every 2 years',
  unknown: 'Recurring',
};

export function licenseIntervalLabel(interval: string | null | undefined): string {
  return LICENSE_INTERVAL_LABELS[(interval ?? 'unknown') as LicenseIntervalValue] ?? 'Recurring';
}

/** How to name the source of a redeemed grant: Gumroad packages vs. admin-minted coupon codes. */
export function licenseProviderLabel(provider: string | null | undefined): string {
  if (provider === 'voucher') return 'Coupon code';
  if (!provider || provider === 'gumroad') return 'Gumroad';
  // A provider we have no wording for is still something the person redeemed;
  // printing the raw column value at them explains nothing.
  return 'Redeemed code';
}

/**
 * How close a fixed-term grant has to get to its end date before it reads
 * "Ending" rather than "Active".
 *
 * A Gumroad membership only carries an end date once it has been cancelled, so
 * that date is news the moment it appears. A coupon grant carries one from the
 * day it is redeemed, and calling a 90-day package "Ending" on day one turns
 * the whole term amber for no reason.
 */
export const LICENSE_ENDING_SOON_DAYS = 14;

export type LicenseTimelineTone = 'renews' | 'ending' | 'ended' | 'revoked';

export type LicenseTimeline = {
  tone: LicenseTimelineTone;
  /** Short badge text: Active, Ending, Ended, Revoked. */
  badge: string;
  /** The date line, e.g. "Renews around Oct 10, 2026" or "Ends Dec 1, 2026". */
  text: string;
};

export function formatLicenseDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function licenseTimeline(
  grant: {
    status?: 'active' | 'ended' | 'revoked';
    ends_at?: number | null;
    renews_at?: number | null;
    provider?: string | null;
  },
  nowUnix: number = Math.floor(Date.now() / 1000),
): LicenseTimeline {
  const status = grant.status ?? 'active';
  const endsAt = grant.ends_at ?? null;
  const gumroad = !grant.provider || grant.provider === 'gumroad';

  if (status === 'revoked') {
    return {
      tone: 'revoked',
      badge: 'Revoked',
      text: endsAt
        ? (gumroad ? `Refunded or disputed on Gumroad · Ended ${formatLicenseDate(endsAt)}` : `Revoked · Ended ${formatLicenseDate(endsAt)}`)
        : (gumroad ? 'Refunded or disputed on Gumroad' : 'Revoked'),
    };
  }
  if (status === 'ended') {
    return {
      tone: 'ended',
      badge: 'Ended',
      text: endsAt ? `Ended ${formatLicenseDate(endsAt)}` : (gumroad ? 'Membership ended on Gumroad' : 'Ended'),
    };
  }
  if (endsAt !== null) {
    // The daily check flips status shortly after the end passes; until then it has still ended.
    if (endsAt <= nowUnix) return { tone: 'ended', badge: 'Ended', text: `Ended ${formatLicenseDate(endsAt)}` };
    if (!gumroad && endsAt - nowUnix > LICENSE_ENDING_SOON_DAYS * 86_400) {
      return { tone: 'renews', badge: 'Active', text: `Ends ${formatLicenseDate(endsAt)}` };
    }
    return { tone: 'ending', badge: 'Ending', text: `Ends ${formatLicenseDate(endsAt)}` };
  }
  if (grant.renews_at) {
    return { tone: 'renews', badge: 'Active', text: `Renews around ${formatLicenseDate(grant.renews_at)}` };
  }
  return { tone: 'renews', badge: 'Active', text: gumroad ? 'Renews through Gumroad' : 'Does not end' };
}

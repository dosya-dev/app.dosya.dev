import { formatDateWith } from '@/lib/format-locale';
import { t } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
// One wording for redeemed-license dates, shared by billing and the workspace
// dashboard so a package never reads "Active" in one place and "Ending" in another.

export type LicenseIntervalValue = 'month' | 'quarter' | 'half_year' | 'year' | 'two_years' | 'unknown';

// Keys, translated when asked for, so a language switch never leaves a stale label.
const LICENSE_INTERVAL_KEYS: Record<LicenseIntervalValue, MessageKey> = {
  month: 'common.label.monthly',
  quarter: 'common.label.quarterly',
  half_year: 'common.label.every6Months',
  year: 'common.label.yearly',
  two_years: 'common.label.every2Years',
  unknown: 'common.label.recurring',
};

export function licenseIntervalLabel(interval: string | null | undefined): string {
  return t(LICENSE_INTERVAL_KEYS[(interval ?? 'unknown') as LicenseIntervalValue] ?? 'common.label.recurring');
}

/** How to name the source of a redeemed grant: Gumroad packages vs. admin-minted coupon codes. */
export function licenseProviderLabel(provider: string | null | undefined): string {
  if (provider === 'voucher') return t('common.label.couponCode');
  if (!provider || provider === 'gumroad') return t('common.label.gumroad');
  // A provider we have no wording for is still something the person redeemed;
  // printing the raw column value at them explains nothing.
  return t('common.label.redeemedCode');
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
  return formatDateWith(unix, { month: 'short', day: 'numeric', year: 'numeric' }, 'en-US');
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
      badge: t('common.status.revoked'),
      text: endsAt
        ? (gumroad
          ? t('common.description.refundedOrDisputedOnGumroadEndedEndsat', { endsAt: formatLicenseDate(endsAt) })
          : t('common.label.revokedEndedEndsat', { endsAt: formatLicenseDate(endsAt) }))
        : (gumroad ? t('common.label.refundedOrDisputedOnGumroad') : t('common.label.revoked')),
    };
  }
  if (status === 'ended') {
    return {
      tone: 'ended',
      badge: t('common.status.ended'),
      text: endsAt ? t('common.label.endedEndsat', { endsAt: formatLicenseDate(endsAt) }) : (gumroad ? t('common.label.membershipEndedOnGumroad') : t('common.label.ended')),
    };
  }
  if (endsAt !== null) {
    // The daily check flips status shortly after the end passes; until then it has still ended.
    if (endsAt <= nowUnix) return { tone: 'ended', badge: t('common.status.ended'), text: t('common.label.endedEndsat', { endsAt: formatLicenseDate(endsAt) }) };
    if (!gumroad && endsAt - nowUnix > LICENSE_ENDING_SOON_DAYS * 86_400) {
      return { tone: 'renews', badge: t('common.status.active.subscription'), text: t('common.label.endsEndsat', { endsAt: formatLicenseDate(endsAt) }) };
    }
    return { tone: 'ending', badge: t('common.status.ending'), text: t('common.label.endsEndsat', { endsAt: formatLicenseDate(endsAt) }) };
  }
  if (grant.renews_at) {
    return { tone: 'renews', badge: t('common.status.active.subscription'), text: t('common.label.renewsAroundGrantrenewsAt', { grantRenews_at: formatLicenseDate(grant.renews_at) }) };
  }
  return { tone: 'renews', badge: t('common.status.active.subscription'), text: gumroad ? t('common.label.renewsThroughGumroad') : t('common.label.doesNotEnd') };
}

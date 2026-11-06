import { api } from "@/api/client";
import { t } from "@/lib/i18n";

export type ReferralFriend = { email_masked: string; status: string; joined_at: number };
export type ReferralSummary = {
    code: string;
    link: string;
    credited_count: number;
    max_rewards: number;
    bonus_bytes: number;
    bonus_label: string;
    friends: ReferralFriend[];
};

export const getReferralSummary = () =>
    api<{ ok: true } & ReferralSummary>("/api/referrals");

/**
 * What a friend's referral status means to the person who invited them.
 * 'held' (a burst of sign-ups awaiting staff review) reads as a review, not a
 * refusal; every way a referral can end without paying reads the same, so the
 * page never explains which anti-farming rule a friend tripped.
 */
export function friendStatusLabel(status: string): string {
  switch (status) {
    case 'credited': return t('referrals.label.counted');
    case 'pending': return t('referrals.label.waitingForActivity');
    case 'held': return t('referrals.label.underReview');
    default: return t('referrals.label.notEligible');
  }
}

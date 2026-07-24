import { api } from "@/api/client";

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

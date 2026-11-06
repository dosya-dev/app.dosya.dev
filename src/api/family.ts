// apps/web/src/api/family.ts
import { api } from '@/api/client';

export type FamilyRole = 'none' | 'payer' | 'member';
export type FamilyMemberView = {
  id: string; email: string; name: string | null;
  status: 'invited' | 'active'; joined_at: number | null; expires_at: number | null;
  /** Active members only: they own more than the free plan holds. Older APIs omit it. */
  over_free?: boolean;
  /** Their active reservation in bytes, or null (always null for invitations and an unpaid pool). Older APIs omit it. */
  reserved_bytes?: number | null;
  /** Active members only: what they take from the pool, as the upload gates count it. */
  used_bytes?: number;
  /** Payer view, active members only: the most that can be reserved for them now (0 when the payer's plan lapsed). */
  max_reservable_bytes?: number;
  /** The member's user id (their usage row's id), null for an invitation. Older APIs omit it. */
  user_id?: string | null;
};
/** One person in the pool, for the Usage tab: totals only, never files. */
export type FamilyUsageRow = {
  id: string; name: string; is_you: boolean; is_payer: boolean;
  used_bytes: number; used_label: string;
  /** Their active reservation in bytes, or null. Older APIs omit it. */
  reserved_bytes?: number | null;
};
export type FamilyView = {
  /** Everyone in the pool, payer first then by usage. Older APIs omit it. */
  usage?: FamilyUsageRow[];
  ok: true;
  role: FamilyRole;
  limit: number;
  /** Places every paid plan includes. Older APIs omit it. */
  included?: number;
  /** Extra places on the payer's subscription. Older APIs omit it. */
  extra_places?: number;
  /** The payer may buy places (paid plan, Stripe subscription). Older APIs omit it. */
  can_buy_places?: boolean;
  /** More people than places; invitations are refused until that changes. Older APIs omit it. */
  over_capacity?: boolean;
  eligible: boolean;
  ineligible_reason: 'free_plan' | 'is_member' | null;
  pool: {
    used_bytes: number; limit_bytes: number; used_label: string; limit_label: string;
    /** Sum of active reservations. Older APIs omit it. */
    reserved_bytes?: number;
    /** Reserved but not yet used. */
    held_bytes?: number;
    /** What people without a reservation can still use. */
    free_bytes?: number;
  };
  /** Active reservations add up to more than the pool (the plan shrank). Older APIs omit it. */
  reservations_exceed_pool?: boolean;
  plan: { id: string; name: string };
  payer: { name: string } | null;
  members: FamilyMemberView[] | null;
  /** Member view only: what the caller stores themselves. Older APIs omit it. */
  own_used_bytes?: number;
  own_used_label?: string;
  /** Member view only: the caller's own active reservation, or null. */
  own_reserved_bytes?: number | null;
};
export type FamilyJoinPreview = {
  ok: true;
  state: 'ready' | 'expired' | 'blocked';
  block?: { code: string; message: string };
  payer: { name: string };
  plan: { id: string; name: string };
  pool_label: string;
  invited_email: string;
};

export const getFamily = () => api<FamilyView>('/api/family');
export const inviteFamilyMember = (email: string) =>
  api<{ ok: true; invite: FamilyMemberView }>('/api/family/invites', { method: 'POST', body: JSON.stringify({ email }) });
export const revokeFamilyInvite = (id: string) => api<{ ok: true }>(`/api/family/invites/${id}`, { method: 'DELETE' });
export const removeFamilyMember = (id: string) => api<{ ok: true }>(`/api/family/members/${id}`, { method: 'DELETE' });
/** Reservations are whole binary gigabytes. */
export const GB = 1_073_741_824;
/** Hold `gb` whole GB for an active member (family_members.id); null removes the reservation. */
export const setFamilyReservation = (memberId: string, gb: number | null) =>
  api<{ ok: true }>(`/api/family/members/${memberId}/reservation`, { method: 'PUT', body: JSON.stringify({ gb }) });
export const leaveFamily = () => api<{ ok: true; plan: { id: string; name: string } }>('/api/family/leave', { method: 'POST' });
export const previewFamilyJoin = (token: string) => api<FamilyJoinPreview>(`/api/family/join/${token}`);
export const acceptFamilyJoin = (token: string) =>
  api<{ ok: true; plan: { id: string; name: string } }>(`/api/family/join/${token}`, { method: 'POST' });

// apps/web/src/api/family.ts
import { api } from '@/api/client';

export type FamilyRole = 'none' | 'payer' | 'member';
export type FamilyMemberView = {
  id: string; email: string; name: string | null;
  status: 'invited' | 'active'; joined_at: number | null; expires_at: number | null;
  /** Active members only: they own more than the free plan holds. Older APIs omit it. */
  over_free?: boolean;
};
/** One person in the pool, for the Usage tab: totals only, never files. */
export type FamilyUsageRow = {
  id: string; name: string; is_you: boolean; is_payer: boolean;
  used_bytes: number; used_label: string;
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
  pool: { used_bytes: number; limit_bytes: number; used_label: string; limit_label: string };
  plan: { id: string; name: string };
  payer: { name: string } | null;
  members: FamilyMemberView[] | null;
  /** Member view only: what the caller stores themselves. Older APIs omit it. */
  own_used_bytes?: number;
  own_used_label?: string;
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
export const leaveFamily = () => api<{ ok: true; plan: { id: string; name: string } }>('/api/family/leave', { method: 'POST' });
export const previewFamilyJoin = (token: string) => api<FamilyJoinPreview>(`/api/family/join/${token}`);
export const acceptFamilyJoin = (token: string) =>
  api<{ ok: true; plan: { id: string; name: string } }>(`/api/family/join/${token}`, { method: 'POST' });

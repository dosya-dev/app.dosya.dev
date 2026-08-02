import { create } from 'zustand';
import { api } from '@/api/client';
import type { DerivationKey, Purpose } from '@/components/onboarding/steps';

export type StepFlags = Record<DerivationKey, boolean>;

interface OnboardingPayload {
  ok: boolean;
  purpose: Purpose | null;
  dismissed: boolean;
  steps: StepFlags;
}

interface OnboardingState {
  purpose: Purpose | null;
  dismissed: boolean;
  /** Null until loaded, and null forever if loading failed. Consumers render nothing while null. */
  steps: StepFlags | null;
  loaded: boolean;
  failed: boolean;
  refresh: (wsId: string) => Promise<void>;
  setPurpose: (purpose: Purpose) => Promise<void>;
  dismiss: () => Promise<void>;
}

/**
 * Onboarding state for the first-run home and the topbar setup pill.
 *
 * Fetched once per session and refreshed on real events (an upload
 * completing, returning from a step's destination) rather than polled - the
 * D1 primary is in Sydney, so every call is a long round trip for a European
 * user.
 *
 * Every failure path here is silent by design. Onboarding is additive: if it
 * cannot load, the app must behave exactly as it would without it.
 */
export const useOnboarding = create<OnboardingState>((set, get) => ({
  purpose: null,
  dismissed: false,
  steps: null,
  loaded: false,
  failed: false,

  refresh: async (wsId: string) => {
    if (!wsId) return;
    // Nothing renders once dismissed, so there is nothing to refresh for.
    if (get().dismissed) return;
    try {
      const res = await api<OnboardingPayload>(`/api/onboarding?workspace_id=${wsId}`);
      set({
        purpose: res.purpose,
        dismissed: res.dismissed,
        steps: res.steps,
        loaded: true,
        failed: false,
      });
    } catch {
      set({ loaded: true, failed: true });
    }
  },

  setPurpose: async (purpose: Purpose) => {
    // Optimistic and never reverted: the user answered, so the answer stands
    // locally even if it did not persist. Worst case it is asked again in a
    // later session, which is a far smaller cost than the picker flickering
    // back to unanswered under their cursor.
    set({ purpose });
    try {
      await api('/api/onboarding', { method: 'PATCH', body: JSON.stringify({ purpose }) });
    } catch {
      try {
        await api('/api/onboarding', { method: 'PATCH', body: JSON.stringify({ purpose }) });
      } catch { /* give up quietly */ }
    }
  },

  dismiss: async () => {
    set({ dismissed: true });
    try {
      await api('/api/onboarding', { method: 'PATCH', body: JSON.stringify({ dismissed: true }) });
    } catch { /* it stays dismissed for this session either way */ }
  },
}));

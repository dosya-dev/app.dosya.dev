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
// Module-scoped rather than in the store, and keyed by workspace id rather
// than a single bare promise: dashboard.tsx and setup-pill.tsx both call
// refresh() on mount while `loaded` is still false, which without this would
// fire two GETs - an 11-statement D1 batch each - against a primary in
// Sydney for the same workspace on every dashboard load. The key matters
// because the dashboard's refresh effect is keyed on [wsId] and fires again
// on every workspace switch: a single bare promise would let an in-flight
// request for workspace A swallow a concurrent call for workspace B, landing
// A's purpose/steps/dismissed in the store while the user is looking at B -
// and if A was dismissed, B's onboarding would stay wrongly suppressed for
// the rest of the session, since refresh() bails early once dismissed.
const inFlight = new Map<string, Promise<void>>();

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
    const existing = inFlight.get(wsId);
    if (existing) return existing;
    const promise = (async () => {
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
      } finally {
        // Keyed removal: only drops THIS workspace's entry. A second call
        // for the same wsId always returns the existing entry above rather
        // than creating a new one, so no other promise can occupy this key
        // while this one is in flight - deleting by key alone is safe and
        // cannot wipe a guard a different workspace has since installed.
        inFlight.delete(wsId);
      }
    })();
    inFlight.set(wsId, promise);
    return promise;
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

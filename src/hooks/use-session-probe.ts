import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { SessionUser } from '@/stores/session';

export type SessionProbe = 'pending' | 'in' | 'out';

export interface SessionAccount {
  status: SessionProbe;
  /** The signed-in account, when the probe found one. Null in every other state. */
  user: SessionUser | null;
}

interface MeBody {
  ok?: boolean;
  user?: SessionUser | null;
}

/**
 * One GET /api/me on mount, with the account it found. A public page cannot
 * otherwise tell whether the visitor is signed in, nor who they are. Any
 * failure (401, offline) means "out".
 *
 * `enabled` is for the consumer that has been handed an answer already: the
 * login and sign-up pages probe once and pass the result to both the navbar
 * and the already-signed-in dialog, so those two surfaces do not each fetch
 * the same thing on a page whose whole job is to be fast.
 */
export function useSessionAccount(enabled: boolean = true): SessionAccount {
  const [account, setAccount] = useState<SessionAccount>({ status: 'pending', user: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<MeBody>('/api/me')
      .then((me) => { if (!cancelled) setAccount({ status: 'in', user: me?.user ?? null }); })
      .catch(() => { if (!cancelled) setAccount({ status: 'out', user: null }); });
    return () => { cancelled = true; };
  }, [enabled]);
  return account;
}

/** Whether the visitor is signed in, for consumers that do not need the account. */
export function useSessionProbe(): SessionProbe {
  return useSessionAccount().status;
}

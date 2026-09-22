import { useEffect, useState } from 'react';
import { api } from '@/api/client';

export type SessionProbe = 'pending' | 'in' | 'out';

/**
 * One GET /api/me on mount. A public page cannot otherwise tell whether the
 * visitor is signed in, and showing "Login" to a signed-in person is the
 * complaint this answers. Any failure (401, offline) means "out".
 */
export function useSessionProbe(): SessionProbe {
  const [state, setState] = useState<SessionProbe>('pending');
  useEffect(() => {
    let cancelled = false;
    api<{ ok?: boolean }>('/api/me')
      .then(() => { if (!cancelled) setState('in'); })
      .catch(() => { if (!cancelled) setState('out'); });
    return () => { cancelled = true; };
  }, []);
  return state;
}

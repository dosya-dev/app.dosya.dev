import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import {
  type IntegrationCtx, WORKSPACE_PLACEHOLDER, EMAIL_PLACEHOLDER,
} from '@/lib/integrations';

// Supplies the two values every setup snippet needs, with safe placeholders
// while they load so the page never blocks on a spinner.
export function useIntegrationCtx(): IntegrationCtx {
  const { activeId } = useWorkspace();
  const [email, setEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<{ ok: boolean; user: { email: string } }>('/api/me')
      .then((r) => { if (!cancelled && r.ok) setEmail(r.user.email); })
      .catch(() => { /* keep placeholder */ });
    return () => { cancelled = true; };
  }, []);

  return {
    workspaceId: activeId || WORKSPACE_PLACEHOLDER,
    email: email || EMAIL_PLACEHOLDER,
  };
}

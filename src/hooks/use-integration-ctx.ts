import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import {
  type IntegrationCtx, WORKSPACE_PLACEHOLDER, EMAIL_PLACEHOLDER,
} from '@/lib/integrations';

// Supplies the values every setup snippet needs, with safe placeholders
// while they load so the page never blocks on a spinner.
export function useIntegrationCtx(): IntegrationCtx {
  const { activeId } = useWorkspace();
  const [email, setEmail] = useState('');
  const [wsName, setWsName] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<{ ok: boolean; user: { email: string } }>('/api/me')
      .then((r) => { if (!cancelled && r.ok) setEmail(r.user.email); })
      .catch(() => { /* keep placeholder */ });
    api<{ ok: boolean; workspaces: { id: string; name: string }[] }>('/api/workspaces')
      .then((r) => {
        if (cancelled || !r.ok) return;
        const active = r.workspaces.find((w) => w.id === activeId);
        if (active) setWsName(active.name);
      })
      .catch(() => { /* keep placeholder */ });
    return () => { cancelled = true; };
  }, [activeId]);

  return {
    workspaceId: activeId || WORKSPACE_PLACEHOLDER,
    workspaceName: wsName,
    email: email || EMAIL_PLACEHOLDER,
  };
}

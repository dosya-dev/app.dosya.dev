import { useState, useEffect, useCallback } from 'react';
import { req } from '@/api/req';
import { ApiKeysSection, type ApiKey } from '@/components/api-keys/api-keys-section';
import { SectionSkeleton, type Workspace } from './shared';

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  const loadKeys = useCallback(async () => {
    const res = await req<{ ok: boolean; keys: ApiKey[] }>('/api/me/api-keys');
    if (res.ok) setKeys(res.keys);
    else setKeys((k) => k ?? []);
  }, []);

  useEffect(() => {
    void loadKeys();
    void req<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces').then((res) => { if (res.ok) setWorkspaces(res.workspaces); });
  }, [loadKeys]);

  if (keys === null) return <SectionSkeleton />;
  return <ApiKeysSection keys={keys} workspaces={workspaces} onChanged={loadKeys} />;
}

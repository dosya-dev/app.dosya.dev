import { useCallback, useEffect, useState } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { timeAgo } from '@/lib/helpers';
import { SectionSkeleton } from './shared';

/** One row of GET /api/me/ai-connections. `clientName` is the AI app's own
 *  self-reported name, so it renders as text only. */
export interface AiConnection {
  id: string;
  clientName: string;
  workspaceId: string;
  workspaceName: string;
  scopes: string[];
  createdAt: number;
}

const SCOPE_CHIPS: Record<string, string> = {
  'files.read': 'Read files',
  'account.read': 'Plan and storage',
};

export const MCP_SERVER_URL = 'https://mcp.dosya.dev/mcp';

export default function AiAppsPage() {
  const [connections, setConnections] = useState<AiConnection[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await req<{ ok: boolean; error?: string; connections?: AiConnection[] }>('/api/me/ai-connections');
    if (res.ok) { setConnections(res.connections ?? []); setLoadError(''); }
    else { setConnections((c) => c ?? []); setLoadError(res.error ?? 'Connected apps could not be loaded.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const disconnect = async (c: AiConnection) => {
    setDisconnecting(c.id);
    const res = await req(`/api/me/ai-connections/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('App disconnected', `${c.clientName} can no longer read ${c.workspaceName}.`);
      void load();
    } else {
      toast.error('Disconnect failed', res.error ?? 'The app could not be disconnected.');
    }
    setDisconnecting(null);
  };

  if (connections === null) return <SectionSkeleton />;

  return (
    <section id="section-ai-apps">
      <h2 className="text-base font-semibold mb-3">Connected AI apps</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        AI assistants such as Claude and ChatGPT you allowed to read one of your workspaces. They are read-only.
        Disconnecting stops access immediately.
      </p>
      <Card>
        <CardContent>
          {loadError && <p role="alert" className="py-3 text-xs text-destructive">{loadError}</p>}
          {connections.length === 0 && !loadError ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No AI apps are connected. Connect one from Claude or ChatGPT using <span className="font-mono">{MCP_SERVER_URL}</span>.
            </p>
          ) : (
            connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-3 border-b last:border-b-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Bot className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{c.clientName}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.workspaceName} · connected {timeAgo(c.createdAt)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.scopes.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{SCOPE_CHIPS[s] ?? s}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline" size="sm" className="text-xs text-destructive border-destructive/30 shrink-0"
                  onClick={() => disconnect(c)} disabled={disconnecting === c.id}
                >
                  {disconnecting === c.id ? <Loader2 className="size-3 animate-spin" /> : 'Disconnect'}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

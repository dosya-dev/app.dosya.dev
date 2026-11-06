import { useCallback, useEffect, useState } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Bot, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';
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

const SCOPE_CHIPS: Record<string, MessageKey> = {
  'files.read': 'profile.label.readFiles',
  'account.read': 'profile.label.planAndStorage',
};

export const MCP_SERVER_URL = 'https://mcp.dosya.dev/mcp';

export default function AiAppsPage() {
  const t = useT();
  const [connections, setConnections] = useState<AiConnection[] | null>(null);
  // The server's own message when it sent one; the fallback is translated at render.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await req<{ ok: boolean; error?: string; connections?: AiConnection[] }>('/api/me/ai-connections');
    if (res.ok) { setConnections(res.connections ?? []); setLoadError(null); }
    else { setConnections((c) => c ?? []); setLoadError(res.error ?? ''); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const disconnect = async (c: AiConnection) => {
    setDisconnecting(c.id);
    const res = await req(`/api/me/ai-connections/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success(t('profile.feedback.appDisconnected'), t('profile.feedback.cclientnameCanNoLongerReadCworkspacename', { cClientName: c.clientName, cWorkspaceName: c.workspaceName }));
      void load();
    } else {
      toast.error(t('common.error.disconnectFailed'), res.error ?? t('profile.error.theAppCouldNotBeDisconnected'));
    }
    setDisconnecting(null);
  };

  if (connections === null) return <SectionSkeleton />;

  return (
    <section id="section-ai-apps">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.connectedAiApps')}</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        {t('profile.description.aiAssistantsSuchAsClaudeAndChatgptYouAllowedToRead')}
      </p>
      <Card>
        <CardContent>
          {loadError !== null && <p role="alert" className="py-3 text-xs text-destructive">{loadError || t('profile.error.connectedAppsCouldNotBeLoaded')}</p>}
          {connections.length === 0 && loadError === null ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              {richText(t('profile.description.noAiAppsAreConnectedConnectOneFromClaudeOrChatgpt', { MCP_SERVER_URL: '{MCP_SERVER_URL}' }), { MCP_SERVER_URL: <span dir="ltr" className="font-mono">{MCP_SERVER_URL}</span> })}
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
                    <p className="text-[11px] text-muted-foreground truncate">{t('profile.label.cworkspacenameConnectedCcreatedat', { cWorkspaceName: c.workspaceName, cCreatedAt: timeAgo(c.createdAt) })}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.scopes.map((s) => (
                        <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{SCOPE_CHIPS[s] ? t(SCOPE_CHIPS[s]) : s}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline" size="sm" className="text-xs text-destructive border-destructive/30 shrink-0"
                  onClick={() => disconnect(c)} disabled={disconnecting === c.id}
                >
                  {disconnecting === c.id ? <Loader2 className="size-3 animate-spin" /> : t('common.action.disconnect')}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

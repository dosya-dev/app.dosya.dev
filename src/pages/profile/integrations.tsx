import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '@/api/client';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plug, Plus, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { timeAgo } from '@/lib/helpers';
import { PROVIDER_LABELS, PROVIDER_ICONS } from '@/lib/cloud-providers';
import { listProviders, type CloudProvider } from '@/api/cloud-import';
import { SectionSkeleton, type DriveAccount } from './shared';

export default function IntegrationsPage() {
  const [accounts, setAccounts] = useState<DriveAccount[] | null>(null);
  const [providers, setProviders] = useState<CloudProvider[]>([]);

  const loadDrive = useCallback(async () => {
    const res = await req<{ ok: boolean; accounts: DriveAccount[] }>('/api/cloud/accounts');
    if (res.ok) setAccounts(res.accounts);
    else setAccounts((a) => a ?? []);
  }, []);

  useEffect(() => {
    void loadDrive();
    // A failed fetch just leaves the connect rows empty - the section still
    // renders any already-connected accounts.
    void listProviders().then(setProviders).catch(() => {});
  }, [loadDrive]);

  if (accounts === null) return <SectionSkeleton />;
  return <IntegrationsSection accounts={accounts} providers={providers} onChanged={loadDrive} />;
}

// ── Integrations ───────────────────────────────────────────

export function IntegrationsSection({ accounts, providers, onChanged }: { accounts: DriveAccount[]; providers: CloudProvider[]; onChanged: () => void }) {
  const t = useT();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    const res = await req(`/api/cloud/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success(t('common.feedback.accountDisconnected'), t('common.feedback.theAccountHasBeenRemoved')); onChanged(); } else toast.error(t('common.error.disconnectFailed'), res.error ?? t('common.error.theAccountCouldNotBeDisconnected'));
    setDisconnecting(null);
  };

  // /api/cloud/accounts already orders rows by provider ASC, so a stable list
  // of the distinct providers present is enough to build each group - no
  // need for a separate Map.
  const connectedProviders = [...new Set(accounts.map((a) => a.provider))];

  return (
    <section id="section-integrations">
      <h2 className="text-base font-semibold mb-3">{t('common.heading.integrations')}</h2>
      <Card>
        <CardContent>
          {providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between py-3 border-b">
              <div className="flex items-center gap-3">
                {PROVIDER_ICONS[p.id]
                  ? <img src={PROVIDER_ICONS[p.id]} width="20" height="20" alt={p.label} />
                  : <Plug className="size-5 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">{p.label}</p>
                  <p className="text-xs text-muted-foreground">{t('profile.label.importFilesDirectlyFromYourPlabel', { pLabel: p.label })}</p>
                </div>
              </div>
              <a href={`${API_BASE}/api/cloud/connect/${p.id}`}>
                <Button variant="outline" size="sm" className="text-xs gap-1">
                  <Plus className="size-3" /> {t('profile.action.connectAccount')}
                </Button>
              </a>
            </div>
          ))}
          {accounts.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t('profile.label.noAccountsConnected')}</p>
          ) : (
            connectedProviders.map((provider) => (
              <div key={provider}>
                {/*
                  PROVIDER_LABELS is keyed by provider id ('google'), NOT by
                  files.import_source ('google-drive') - IMPORT_SOURCE_LABELS
                  looks identical but is the wrong map here. Because of the
                  `?? provider` fallback below, using it wouldn't blank this
                  heading out; it would silently render the raw provider id
                  ("google") instead of "Google Drive" - just as wrong, only
                  quieter, since it still looks like a rendered label rather
                  than an obviously broken one.
                */}
                <p
                  data-testid="provider-group-heading"
                  className="pt-3 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
                >
                  {PROVIDER_LABELS[provider] ?? provider}
                </p>
                {accounts.filter((a) => a.provider === provider).map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between py-3 border-b last:border-b-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        {PROVIDER_ICONS[acc.provider] ? (
                          <img src={PROVIDER_ICONS[acc.provider]} width="16" height="16" alt="" />
                        ) : (
                          <Plug className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{acc.account_email}</p>
                        <p className="text-[11px] text-muted-foreground">{t('common.label.connectedAcccreatedAt', { date: timeAgo(acc.created_at) })}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="text-xs text-destructive border-destructive/30" onClick={() => disconnect(acc.id)} disabled={disconnecting === acc.id}>
                      {disconnecting === acc.id ? <Loader2 className="size-3 animate-spin" /> : t('common.action.disconnect')}
                    </Button>
                  </div>
                ))}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

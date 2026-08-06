import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { disconnectAccount, listAccounts, type CloudAccount } from '@/api/cloud-import';
import { PROVIDER_ICONS, PROVIDER_LABELS } from '@/lib/cloud-providers';
import { timeAgo } from '@/lib/helpers';
import { toast } from '@/lib/toast';

/**
 * Which accounts of one provider are connected, shown on that provider's
 * /integrations setup page - the page a user connects FROM, so after the
 * OAuth round trip they can come back and see exactly which account is
 * linked and since when. Profile's Integrations section stays the
 * all-providers management surface; this card is deliberately scoped to a
 * single provider.
 */
export function ConnectedAccountsCard({ provider }: { provider: string }) {
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await listAccounts();
      setAccounts(all.filter((a) => a.provider === provider));
      setLoaded(true);
    } catch {
      // Leave the card unrendered rather than flashing a wrong empty state.
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (id: string) => {
    setDisconnecting(id);
    try {
      await disconnectAccount(id);
      toast.success('Account disconnected', 'The account has been removed.');
      await load();
    } catch {
      toast.error('Disconnect failed', 'The account could not be disconnected.');
    } finally {
      setDisconnecting(null);
    }
  };

  if (!loaded) return null;

  const label = PROVIDER_LABELS[provider] ?? provider;

  return (
    <div className="mt-2 rounded-lg border bg-card p-3" data-testid="connected-accounts-card">
      <p className="text-xs font-semibold mb-1">Connected accounts</p>
      {accounts.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">No {label} account connected yet.</p>
      ) : (
        accounts.map((acc) => (
          <div key={acc.id} className="flex items-center justify-between py-2 border-b last:border-b-0">
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
                <p className="text-[11px] text-muted-foreground">Connected {timeAgo(acc.created_at)}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs text-destructive border-destructive/30"
              onClick={() => disconnect(acc.id)}
              disabled={disconnecting === acc.id}
            >
              {disconnecting === acc.id ? <Loader2 className="size-3 animate-spin" /> : 'Disconnect'}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

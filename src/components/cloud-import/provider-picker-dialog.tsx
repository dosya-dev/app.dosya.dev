import { useEffect, useState } from 'react';
import { Folder, File as FileIcon, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { API_BASE } from '@/api/client';
import { listAccounts, type CloudAccount, type CloudEntryDto } from '@/api/cloud-import';
import { useCloudImports } from '@/stores/cloud-imports';
import { useWorkspace } from '@/stores/workspace';
import { useCloudBrowser } from './use-cloud-browser';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string;
  /** Destination folder in dosya. null = workspace root. */
  destFolderId: string | null;
  destLabel?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google Drive',
};

/**
 * Lets a user browse a connected cloud account and pick files/folders to
 * import into dosya. This is the first (and, until more providers land, only)
 * UI that reaches the cloud-import engine - connecting an account previously
 * led nowhere.
 *
 * Folder structure is preserved by the backend during discovery: ticking a
 * folder imports its whole subtree intact, so this dialog never needs to
 * expand a folder before it can be selected.
 */
export function ProviderPickerDialog({
  open, onOpenChange, provider, destFolderId, destLabel,
}: Props) {
  const workspaceId = useWorkspace((s) => s.activeId);
  const start = useCloudImports((s) => s.start);

  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAccountsLoaded(false);
    void listAccounts().then((all) => {
      // If `open`/`provider` changed again before this resolved, this
      // response belongs to a request that's no longer current - applying it
      // would stomp whatever the newer effect run already set.
      if (cancelled) return;
      const mine = all.filter((a) => a.provider === provider);
      setAccounts(mine);
      setAccountId((current) => current ?? mine[0]?.id ?? null);
      setAccountsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [open, provider]);

  const browser = useCloudBrowser(accountId);
  const connectUrl = `${API_BASE}/api/cloud/connect/${provider}`;
  const providerLabel = PROVIDER_LABELS[provider] ?? provider;

  // Reopening the dialog must not resurrect a stale browse (crumbs/selection/
  // notices left over from before it was closed) - matches
  // folder-picker-dialog.tsx's own open-keyed reset convention. browser.reset
  // is stable (useCallback([]) inside useCloudBrowser), so this only actually
  // does anything on a real open transition, not on every render. Depending
  // on the whole `browser` object instead (as exhaustive-deps would prefer)
  // would be wrong here: it's a new object every render, so the effect would
  // re-fire - and wipe crumbs/selection - on every render while open stays
  // true, breaking normal navigation.
  useEffect(() => {
    if (open) browser.reset();
  }, [open, browser.reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSelected = (id: string) => browser.selection.some((e) => e.id === id);

  async function onImport() {
    if (!workspaceId || !accountId) return;
    setStarting(true);
    try {
      await start({
        accountId,
        workspaceId,
        destFolderId,
        selection: browser.selection,
      });
      browser.clearSelection();
      onOpenChange(false);
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from {providerLabel}</DialogTitle>
        </DialogHeader>

        {!accountsLoaded ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>No account connected yet.</p>
            <Button className="mt-3" nativeButton={false} render={<a href={connectUrl} />}>
              Connect an account
            </Button>
          </div>
        ) : browser.reconnectRequired ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <p>This account needs to be reconnected with read permission.</p>
            <Button className="mt-3" nativeButton={false} render={<a href={connectUrl} />}>
              Reconnect
            </Button>
          </div>
        ) : (
          <>
            {accounts.length > 1 && (
              <select
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                value={accountId ?? ''}
                onChange={(e) => {
                  // Switching accounts has the same root cause as reopening:
                  // a folder id and a selection made in account A mean
                  // nothing (or worse, the wrong thing) in account B.
                  setAccountId(e.target.value);
                  browser.reset();
                }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.account_email}</option>
                ))}
              </select>
            )}

            {/* Breadcrumb trail */}
            <div
              data-testid="cloud-import-breadcrumbs"
              className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
            >
              {browser.crumbs.map((crumb, index) => (
                <span key={`${crumb.id}-${index}`} className="flex items-center gap-1">
                  {index > 0 && <span aria-hidden>/</span>}
                  <button
                    type="button"
                    className="hover:text-foreground hover:underline"
                    onClick={() => browser.goTo(index)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>

            {browser.rateLimitedSeconds !== null && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {providerLabel} is briefly rate-limiting requests - retrying automatically in
                {' '}{browser.rateLimitedSeconds}s.
              </p>
            )}

            {browser.error && !browser.reconnectRequired && browser.rateLimitedSeconds === null && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span>{browser.error}</span>
                <Button variant="ghost" size="xs" onClick={() => browser.reload()}>Retry</Button>
              </div>
            )}

            <div className="max-h-80 overflow-y-auto rounded-md border">
              {browser.loading && browser.entries.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {browser.entries.map((entry: CloudEntryDto) => (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
                    >
                      <Checkbox
                        checked={isSelected(entry.id)}
                        disabled={entry.unsupported}
                        onCheckedChange={() => browser.toggle(entry)}
                        aria-label={`Select ${entry.name}`}
                      />
                      {entry.kind === 'folder'
                        ? <Folder className="size-4 text-muted-foreground" />
                        : <FileIcon className="size-4 text-muted-foreground" />}
                      {entry.kind === 'folder' ? (
                        <button
                          type="button"
                          className="truncate hover:underline"
                          onClick={() => browser.enter(entry)}
                        >
                          {entry.name}
                        </button>
                      ) : (
                        <span className="truncate">{entry.name}</span>
                      )}
                      {entry.unsupported && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          Cannot be imported
                        </span>
                      )}
                      {entry.exportAs && (
                        <span className="ml-auto text-xs text-muted-foreground">
                          will import as {entry.exportAs.ext}
                        </span>
                      )}
                    </div>
                  ))}
                  {browser.entries.length === 0 && !browser.error && browser.rateLimitedSeconds === null && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                      This folder is empty.
                    </p>
                  )}
                </>
              )}
            </div>

            {browser.cursor && (
              <Button variant="ghost" size="sm" onClick={() => browser.loadMore()}>
                Load more
              </Button>
            )}
          </>
        )}

        <DialogFooter className="items-center justify-between gap-3 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {browser.selection.length} selected - importing into{' '}
            {destLabel ?? (destFolderId ? 'this folder' : 'workspace root')}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              disabled={browser.selection.length === 0 || starting || !workspaceId}
              onClick={() => void onImport()}
            >
              {starting ? 'Starting...' : 'Import'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

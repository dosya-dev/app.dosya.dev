import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, KeyRound, Loader2, MoreVertical, Plus, Trash2 } from 'lucide-react';
import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { CopyCheck } from '@/components/ui/copy-check';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { timeAgo } from '@/lib/helpers';
import {
  getIntegration, N8N_EXAMPLES_URL, N8N_KEY_NAME, N8N_NODE_PUBLISHED, N8N_PACKAGE_NAME,
} from '@/lib/integrations';
import { toast } from '@/lib/toast';
import { t, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { cn } from '@/lib/utils';

const meta = getIntegration('n8n')!;

/*
 * Keys-first page for the n8n node, laid out like the WordPress page: what is
 * connected, whether it will work, and how to add one.
 *
 * "Connected" here means an API key named n8n. The node signs in with a
 * pasted key (apps/n8n/credentials), so the key IS the connection, and the
 * three ways a key silently breaks the node are each shown as a status:
 * a scope below full, a folder anchor (REST refuses those), and expiry.
 * Creating a key from this page always makes the one shape that works: full
 * scope, no folder anchor, optionally pinned to a single workspace.
 *
 * N8N_NODE_PUBLISHED: until the package is on npm, the install step says so
 * instead of telling anyone to install it.
 */

export interface N8nKey {
  id: string;
  name: string;
  scope: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  workspace_id: string | null;
  root_folder_id: string | null;
}
interface Workspace { id: string; name: string }

const WHOLE_ACCOUNT = '__all__';

/** Read straight from error-copy (this page's test mocks the client down to api + ApiError). */
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string; message?: string };
      if (parsed.message) return parsed.message;
      if (parsed.error) return humanizeApiError(parsed.error);
    } catch { /* non-JSON body */ }
    if (err.body && !err.body.trimStart().startsWith('<')) return err.body;
    return t('common.error.requestFailedErrstatusPleaseTryAgain', { errStatus: err.status });
  }
  return fallback;
}

/** The keys this page manages: the ones named for n8n. */
export function isN8nKey(k: { name: string }): boolean {
  return /\bn8n\b/i.test(k.name);
}

type Tone = 'green' | 'amber' | 'grey';
const DOT: Record<Tone, string> = { green: 'bg-green-500', amber: 'bg-amber-500', grey: 'bg-muted-foreground' };

/** Whether the node can use this key, worst problem first. */
export function keyStatus(k: N8nKey, now: number): { text: string; tone: Tone } {
  if (k.expires_at !== null && k.expires_at <= now) return { text: t('integrations-n8n.label.expiredCreateANewKey'), tone: 'amber' };
  if (k.root_folder_id) return { text: t('integrations-n8n.error.folderAnchoredN8nCannotUseIt'), tone: 'amber' };
  if (k.scope === 'read') return { text: t('integrations-n8n.label.readOnlyUploadsWillFail'), tone: 'amber' };
  if (k.scope !== 'full') return { text: t('integrations-n8n.label.kscopeScopeN8nNeedsFullAccess', { kScope: k.scope }), tone: 'amber' };
  if (k.last_used_at === null) return { text: t('integrations-n8n.label.readyNotUsedYet'), tone: 'grey' };
  return { text: t('common.label.connected'), tone: 'green' };
}

function reachOf(k: N8nKey, workspaces: Workspace[]): string {
  if (!k.workspace_id) return t('integrations-n8n.label.everyWorkspace');
  return workspaces.find((w) => w.id === k.workspace_id)?.name ?? t('integrations-n8n.label.oneWorkspace');
}

function KeyRow({
  k, workspaces, now, onRevoke,
}: { k: N8nKey; workspaces: Workspace[]; now: number; onRevoke: (k: N8nKey) => void }) {
  const t = useT();
  const status = keyStatus(k, now);
  return (
    <tr className="border-t align-top" data-testid="n8n-key-row">
      <td className="px-4 py-3">
        <div className="font-medium">{k.name}</div>
        <div className="text-xs text-muted-foreground">{t('common.label.createdDate', { date: timeAgo(k.created_at) })}</div>
      </td>
      <td className="px-4 py-3">{k.last_used_at ? timeAgo(k.last_used_at) : <span className="text-muted-foreground">{t('common.label.never')}</span>}</td>
      <td className="px-4 py-3">{reachOf(k, workspaces)}</td>
      <td className="px-4 py-3">
        <span className="inline-flex items-start gap-1.5">
          <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', DOT[status.tone])} />
          <span>{status.text}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t('common.accessibility.actionsForName', { name: k.name })}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onRevoke(k)}>
                <Trash2 className="size-4" /> {t('common.action.revoke')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
}

function SkeletonRows() {
  return (
    <>
      {[0, 1].map((i) => (
        <tr key={i} className="border-t" data-testid="n8n-key-skeleton">
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /><Skeleton className="mt-1.5 h-3 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="ms-auto h-7 w-7" /></td>
        </tr>
      ))}
    </>
  );
}

function CreateKeyDialog({
  open, workspaces, onClose, onCreated,
}: { open: boolean; workspaces: Workspace[]; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [reach, setReach] = useState(WHOLE_ACCOUNT);
  const [creating, setCreating] = useState(false);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (open) { setReach(WHOLE_ACCOUNT); setPlainKey(null); setCopied(false); }
  }, [open]);

  const create = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setCreating(true);
    try {
      // Always the shape the node needs: full scope, no folder anchor.
      const body: Record<string, unknown> = { name: N8N_KEY_NAME, scope: 'full' };
      if (reach !== WHOLE_ACCOUNT) body.workspace_id = reach;
      const res = await api<{ key: { plain_key: string } }>('/api/me/api-keys', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setPlainKey(res.key.plain_key);
      onCreated();
    } catch (e) {
      toast.error(t('integrations-n8n.error.couldNotCreateTheKey'), errorMessage(e, t('common.error.pleaseTryAgain')));
    } finally {
      inFlight.current = false;
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!plainKey) return;
    await navigator.clipboard.writeText(plainKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const items = [
    { value: WHOLE_ACCOUNT, label: t('integrations-n8n.label.everyWorkspace') },
    ...workspaces.map((w) => ({ value: w.id, label: w.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !creating) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {plainKey === null ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('integrations-n8n.heading.createAKeyForN8n')}</DialogTitle>
              <DialogDescription>
                {t('integrations-n8n.description.aFullAccessKeyNamedN8nWhichIsWhatTheDosyaDevNode')}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="n8n-reach">{t('integrations-n8n.label.workflowsCanReach')}</label>
              <Select value={reach} onValueChange={(v) => setReach(v as string)} items={items}>
                <SelectTrigger id="n8n-reach" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={creating}>{t('common.cancel')}</Button>
              <Button onClick={create} disabled={creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                {t('integrations-n8n.action.createKey')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('integrations-n8n.heading.yourN8nKeyIsReady')}</DialogTitle>
              <DialogDescription>{t('common.description.thisIsTheOnlyTimeTheKeyIsShownCopyIt')}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code dir="ltr" data-testid="n8n-plain-key" className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{plainKey}</code>
              <Button variant="outline" size="sm" onClick={copy} aria-label={t('common.action.copyKey')}>
                <CopyCheck copied={copied} className="size-3.5" /> {t('common.copy')}
              </Button>
            </div>
            <p className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed">
              {richText(t('integrations-n8n.description.inN8nOpenEmphasis1AddAEmphasis2CredentialAndPasteThis'), {
                emphasis1: <b className="font-semibold">Credentials</b>,
                emphasis2: <b className="font-semibold">dosya.dev API</b>,
              })}
            </p>
            <DialogFooter><Button onClick={onClose}>{t('common.done')}</Button></DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KeysCard({ onLoaded }: { onLoaded: (hasKeys: boolean) => void }) {
  const t = useT();
  const [keys, setKeys] = useState<N8nKey[] | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<N8nKey | null>(null);
  const [revoking, setRevoking] = useState(false);
  const inFlight = useRef(false);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    try {
      const res = await api<{ keys: N8nKey[] }>('/api/me/api-keys');
      const mine = res.keys.filter(isN8nKey);
      setKeys(mine);
      setError(null);
      onLoaded(mine.length > 0);
    } catch (e) {
      setError(errorMessage(e, t('integrations-n8n.error.couldNotLoadYourApiKeysPleaseTryAgain')));
      onLoaded(false);
    }
  }, [onLoaded, t]);

  useEffect(() => {
    void load();
    // The workspace names only label the Reach column and the picker, so a
    // failure here costs nothing but those labels.
    api<{ workspaces: Workspace[] }>('/api/workspaces').then((r) => setWorkspaces(r.workspaces)).catch(() => {});
  }, [load]);

  const confirmRevoke = useCallback(async () => {
    if (!target || inFlight.current) return;
    const key = target;
    inFlight.current = true;
    setRevoking(true);
    try {
      await api(`/api/me/api-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
      setKeys((cur) => (cur ? cur.filter((k) => k.id !== key.id) : cur));
      toast.success(t('common.feedback.keyRevoked'), t('integrations-n8n.feedback.workflowsUsingItWillBeRefusedFromNowOn'));
      setTarget(null);
      void load();
    } catch (e) {
      toast.error(t('common.error.revokeFailed'), errorMessage(e, t('common.error.pleaseTryAgain')));
    } finally {
      inFlight.current = false;
      setRevoking(false);
    }
  }, [target, load, t]);

  const loading = keys === null && error === null;
  const empty = keys !== null && keys.length === 0;

  return (
    <section className="mb-6 rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <h2 className="text-sm font-semibold">{t('integrations-n8n.heading.yourN8nKeys')}</h2>
        {!empty && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> {t('integrations-n8n.action.newKey')}
          </Button>
        )}
      </div>

      {error && <p dir="auto" role="alert" className="border-t px-4 py-3 text-sm text-destructive">{error}</p>}

      {empty && (
        <div className="space-y-3 border-t px-4 py-6 text-center">
          <p className="text-sm font-medium">{t('integrations-n8n.description.noN8nKeyYet')}</p>
          <div className="flex justify-center">
            <Button className="h-9 gap-2 px-4" onClick={() => setCreating(true)}>
              <KeyRound className="size-4" /> {t('integrations-n8n.action.createAKeyForN8n')}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('integrations-n8n.description.pasteItIntoADosyaDevApiCredentialInN8nYourDosya')}
          </p>
        </div>
      )}

      {!error && !empty && (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-t">
                <th className="px-4 py-2 font-medium">{t('common.label.key')}</th>
                <th className="px-4 py-2 font-medium">{t('common.label.lastUsed')}</th>
                <th className="px-4 py-2 font-medium">{t('common.label.reach')}</th>
                <th className="px-4 py-2 font-medium">{t('common.column.status')}</th>
                <th className="px-4 py-2 text-end font-medium"><span className="sr-only">{t('common.label.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows />}
              {keys?.map((k) => (
                <KeyRow key={k.id} k={k} workspaces={workspaces} now={now} onRevoke={setTarget} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && !empty && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {richText(t('integrations-n8n.description.keysNamedN8nAreListedHereEveryKeyWithItsFull'), {
            link1: (
              <Link to="/profile/api" className="underline underline-offset-2 hover:text-foreground">{t('integrations-n8n.action.profileApiKeys')}</Link>
            ),
          })}
        </p>
      )}

      <CreateKeyDialog
        open={creating}
        workspaces={workspaces}
        onClose={() => setCreating(false)}
        onCreated={() => void load()}
      />

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o && !revoking) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('integrations-n8n.heading.revokeTargetname', { name: target?.name ?? '' })}</DialogTitle>
            <DialogDescription>
              {t('integrations-n8n.description.workflowsUsingThisKeyStopWorkingImmediatelyFilesTheyAlreadySaved')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={revoking}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={confirmRevoke} disabled={revoking}>
              {revoking && <Loader2 className="size-4 animate-spin" />}
              {t('common.action.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RailStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[11px]">{n}</span>
        {title}
      </h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function SetupCard({ title }: { title: string }) {
  const t = useT();
  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-3">
        <RailStep n={1} title={t('common.tooltip.install')}>
          {N8N_NODE_PUBLISHED ? (
            <>
              {richText(t('integrations-n8n.description.inN8nOpenSettingsCommunityNodesChooseInstallAndEnter'), {
                emphasis1: <code className="text-[11px] text-foreground">{N8N_PACKAGE_NAME}</code>,
              })}
            </>
          ) : (
            <>
              {richText(t('integrations-n8n.description.theNodeIsBeingPublishedAsEmphasis1OnceItIsOut'), {
                emphasis1: <code className="text-[11px] text-foreground">{N8N_PACKAGE_NAME}</code>,
              })}
            </>
          )}
        </RailStep>
        <RailStep n={2} title={t('common.tooltip.connect')}>
          {t('integrations-n8n.description.createAKeyAboveThenInN8nAddADosyaDevApi')}
        </RailStep>
        <RailStep n={3} title={t('integrations-n8n.tooltip.automate')}>
          {N8N_NODE_PUBLISHED ? (
            <>
              {richText(t('integrations-n8n.description.importALink1OrAddADosyaDevStepToYourOwn'), {
                link1: (
                  <a href={N8N_EXAMPLES_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                    {t('integrations-n8n.action.readyMadeWorkflow')}
                  </a>
                ),
              })}
            </>
          ) : (
            <>
              {t('integrations-n8n.description.addADosyaDevStepToAWorkflowToUploadDownloadAnd')}
            </>
          )}
        </RailStep>
      </div>
    </section>
  );
}

export default function N8nSetup() {
  const t = useT();
  const [hasKeys, setHasKeys] = useState(true);
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <KeysCard onLoaded={setHasKeys} />
      <SetupCard title={hasKeys ? t('integrations-n8n.tooltip.setUpAnotherWorkflow') : t('integrations-n8n.tooltip.setUpN8n')} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{t('integrations-n8n.description.aRetriedUploadNeverStoresAFileTwice')}</span>
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
        >
          {t('integrations-n8n.action.n8nIntegrationPage')} <ExternalLink className="size-3" />
        </a>
        <Link to="/billing" className="underline underline-offset-2 hover:text-foreground">
          {t('common.action.whatEachPlanIncludes')}
        </Link>
      </p>
    </IntegrationLayout>
  );
}

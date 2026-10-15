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
    return `Request failed (${err.status}). Please try again.`;
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
  if (k.expires_at !== null && k.expires_at <= now) return { text: 'Expired, create a new key', tone: 'amber' };
  if (k.root_folder_id) return { text: 'Folder-anchored, n8n cannot use it', tone: 'amber' };
  if (k.scope === 'read') return { text: 'Read only, uploads will fail', tone: 'amber' };
  if (k.scope !== 'full') return { text: `${k.scope} scope, n8n needs full access`, tone: 'amber' };
  if (k.last_used_at === null) return { text: 'Ready, not used yet', tone: 'grey' };
  return { text: 'Connected', tone: 'green' };
}

function reachOf(k: N8nKey, workspaces: Workspace[]): string {
  if (!k.workspace_id) return 'Every workspace';
  return workspaces.find((w) => w.id === k.workspace_id)?.name ?? 'One workspace';
}

function KeyRow({
  k, workspaces, now, onRevoke,
}: { k: N8nKey; workspaces: Workspace[]; now: number; onRevoke: (k: N8nKey) => void }) {
  const status = keyStatus(k, now);
  return (
    <tr className="border-t align-top" data-testid="n8n-key-row">
      <td className="px-4 py-3">
        <div className="font-medium">{k.name}</div>
        <div className="text-xs text-muted-foreground">Created {timeAgo(k.created_at)}</div>
      </td>
      <td className="px-4 py-3">{k.last_used_at ? timeAgo(k.last_used_at) : <span className="text-muted-foreground">Never</span>}</td>
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
              aria-label={`Actions for ${k.name}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onRevoke(k)}>
                <Trash2 className="size-4" /> Revoke
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
          <td className="px-4 py-3"><Skeleton className="ml-auto h-7 w-7" /></td>
        </tr>
      ))}
    </>
  );
}

function CreateKeyDialog({
  open, workspaces, onClose, onCreated,
}: { open: boolean; workspaces: Workspace[]; onClose: () => void; onCreated: () => void }) {
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
      toast.error('Could not create the key', errorMessage(e, 'Please try again.'));
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
    { value: WHOLE_ACCOUNT, label: 'Every workspace' },
    ...workspaces.map((w) => ({ value: w.id, label: w.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !creating) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {plainKey === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create a key for n8n</DialogTitle>
              <DialogDescription>
                A full-access key named n8n, which is what the dosya.dev node needs. Pin it to one
                workspace to keep your workflows out of the others.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <label className="text-xs font-medium" htmlFor="n8n-reach">Workflows can reach</label>
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
              <Button variant="outline" onClick={onClose} disabled={creating}>Cancel</Button>
              <Button onClick={create} disabled={creating}>
                {creating && <Loader2 className="size-4 animate-spin" />}
                Create key
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Your n8n key is ready</DialogTitle>
              <DialogDescription>This is the only time the key is shown. Copy it now.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code data-testid="n8n-plain-key" className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{plainKey}</code>
              <Button variant="outline" size="sm" onClick={copy} aria-label="Copy key">
                <CopyCheck copied={copied} className="size-3.5" /> Copy
              </Button>
            </div>
            <p className="rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed">
              In n8n, open <b className="font-semibold">Credentials</b>, add a <b className="font-semibold">dosya.dev API</b> credential
              and paste this key. n8n checks it straight away.
            </p>
            <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KeysCard({ onLoaded }: { onLoaded: (hasKeys: boolean) => void }) {
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
      setError(errorMessage(e, 'Could not load your API keys. Please try again.'));
      onLoaded(false);
    }
  }, [onLoaded]);

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
      toast.success('Key revoked', 'Workflows using it will be refused from now on.');
      setTarget(null);
      void load();
    } catch (e) {
      toast.error('Revoke failed', errorMessage(e, 'Please try again.'));
    } finally {
      inFlight.current = false;
      setRevoking(false);
    }
  }, [target, load]);

  const loading = keys === null && error === null;
  const empty = keys !== null && keys.length === 0;

  return (
    <section className="mb-6 rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <h2 className="text-sm font-semibold">Your n8n keys</h2>
        {!empty && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New key
          </Button>
        )}
      </div>

      {error && <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">{error}</p>}

      {empty && (
        <div className="space-y-3 border-t px-4 py-6 text-center">
          <p className="text-sm font-medium">No n8n key yet.</p>
          <div className="flex justify-center">
            <Button className="h-9 gap-2 px-4" onClick={() => setCreating(true)}>
              <KeyRound className="size-4" /> Create a key for n8n
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Paste it into a dosya.dev API credential in n8n. Your dosya password is never needed.
          </p>
        </div>
      )}

      {!error && !empty && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-t">
                <th className="px-4 py-2 font-medium">Key</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 font-medium">Reach</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
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
          Keys named n8n are listed here. Every key, with its full settings, is in{' '}
          <Link to="/profile/api" className="underline underline-offset-2 hover:text-foreground">Profile › API keys</Link>.
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
            <DialogTitle>Revoke {target?.name}?</DialogTitle>
            <DialogDescription>
              Workflows using this key stop working immediately. Files they already saved are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={revoking}>Cancel</Button>
            <Button variant="destructive" onClick={confirmRevoke} disabled={revoking}>
              {revoking && <Loader2 className="size-4 animate-spin" />}
              Revoke
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
  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-3">
        <RailStep n={1} title="Install">
          {N8N_NODE_PUBLISHED ? (
            <>
              In n8n, open Settings › Community Nodes, choose Install and enter{' '}
              <code className="text-[11px] text-foreground">{N8N_PACKAGE_NAME}</code>. Self-hosted n8n, or n8n Cloud
              once the node is verified.
            </>
          ) : (
            <>
              The node is being published as{' '}
              <code className="text-[11px] text-foreground">{N8N_PACKAGE_NAME}</code>. Once it is out, install it from
              Settings › Community Nodes in n8n.
            </>
          )}
        </RailStep>
        <RailStep n={2} title="Connect">
          Create a key above, then in n8n add a dosya.dev API credential and paste it. The node only ever sends the
          key to dosya.
        </RailStep>
        <RailStep n={3} title="Automate">
          {N8N_NODE_PUBLISHED ? (
            <>
              Import a{' '}
              <a href={N8N_EXAMPLES_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
                ready-made workflow
              </a>{' '}
              or add a dosya.dev step to your own: upload, download, list, create folders and share links.
            </>
          ) : (
            <>
              Add a dosya.dev step to a workflow to upload, download and list files, create folders and share links.
              Ready-made workflows ship with the node.
            </>
          )}
        </RailStep>
      </div>
    </section>
  );
}

export default function N8nSetup() {
  const [hasKeys, setHasKeys] = useState(true);
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <KeysCard onLoaded={setHasKeys} />
      <SetupCard title={hasKeys ? 'Set up another workflow' : 'Set up n8n'} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>A retried upload never stores a file twice.</span>
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
        >
          n8n integration page <ExternalLink className="size-3" />
        </a>
        <Link to="/billing" className="underline underline-offset-2 hover:text-foreground">
          What each plan includes
        </Link>
      </p>
    </IntegrationLayout>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, MoreVertical, Trash2 } from 'lucide-react';
import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { Button, buttonVariants } from '@/components/ui/button';
import { CopyCheck } from '@/components/ui/copy-check';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { timeAgo } from '@/lib/helpers';
import { getIntegration, LIGHTROOM_KEY_PREFIX, LIGHTROOM_PLUGIN_URL } from '@/lib/integrations';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/stores/workspace';

const meta = getIntegration('lightroom')!;

/*
 * Connections and galleries for the Lightroom Classic plug-in.
 *
 * A connection is an API key the plug-in's connect flow created, named
 * "Lightroom Classic: <device>"; revoking it signs that catalog out of dosya.
 * Galleries come from the active workspace and are read-only here: the plug-in
 * is where they are published and changed.
 */

export interface LightroomKey {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}

export interface Gallery {
  id: string;
  title: string;
  item_count: number;
  client_count: number;
  selection_count: number;
  selections_enabled: boolean;
  /** null when the gallery's link row is gone (the API answers share: null). */
  share: {
    url: string;
    expires_at: number | null;
    is_password_protected: boolean;
    is_revoked: boolean;
  } | null;
}

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

/** The keys this page manages: the ones the plug-in's connect flow made. */
export function isLightroomKey(k: { name: string }): boolean {
  return k.name.startsWith(LIGHTROOM_KEY_PREFIX);
}

export function deviceOf(k: { name: string }): string {
  return k.name.slice(LIGHTROOM_KEY_PREFIX.length).trim() || 'Lightroom Classic';
}

type Tone = 'green' | 'amber' | 'grey';
const DOT: Record<Tone, string> = { green: 'bg-green-500', amber: 'bg-amber-500', grey: 'bg-muted-foreground' };

/** The link's state, worst first. */
export function linkState(g: Gallery, now: number): { text: string; tone: Tone } {
  if (!g.share) return { text: 'Link removed', tone: 'grey' };
  if (g.share.is_revoked) return { text: 'Link revoked', tone: 'amber' };
  if (g.share.expires_at !== null && g.share.expires_at <= now) return { text: 'Link expired', tone: 'amber' };
  if (g.share.is_password_protected) return { text: 'Password protected', tone: 'green' };
  return { text: 'Live', tone: 'green' };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ConnectionsCard() {
  const [keys, setKeys] = useState<LightroomKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<LightroomKey | null>(null);
  const [revoking, setRevoking] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ keys: LightroomKey[] }>('/api/me/api-keys');
      setKeys(res.keys.filter(isLightroomKey));
      setError(null);
    } catch (e) {
      setError(errorMessage(e, 'Could not load your connections. Please try again.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmRevoke = useCallback(async () => {
    if (!target || inFlight.current) return;
    const key = target;
    inFlight.current = true;
    setRevoking(true);
    try {
      await api(`/api/me/api-keys/${encodeURIComponent(key.id)}`, { method: 'DELETE' });
      setKeys((cur) => (cur ? cur.filter((k) => k.id !== key.id) : cur));
      toast.success('Connection revoked', 'That catalog is signed out of dosya.');
      setTarget(null);
    } catch (e) {
      toast.error('Revoke failed', errorMessage(e, 'Please try again.'));
    } finally {
      inFlight.current = false;
      setRevoking(false);
    }
  }, [target]);

  const loading = keys === null && error === null;
  const empty = keys !== null && keys.length === 0;

  return (
    <section className="mb-6 rounded-xl border bg-card">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold">Your Lightroom connections</h2>
      </div>
      {error && <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">{error}</p>}
      {loading && (
        <div className="border-t px-4 py-3" data-testid="lr-conn-skeleton"><Skeleton className="h-4 w-40" /></div>
      )}
      {empty && (
        <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
          No catalog is connected yet. Follow the steps below to connect one.
        </p>
      )}
      {keys !== null && keys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-t">
                <th className="px-4 py-2 font-medium">Computer</th>
                <th className="px-4 py-2 font-medium">Last used</th>
                <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t align-top" data-testid="lr-key-row">
                  <td className="px-4 py-3">
                    <div className="font-medium">{deviceOf(k)}</div>
                    <div className="text-xs text-muted-foreground">Connected {timeAgo(k.created_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    {k.last_used_at ? timeAgo(k.last_used_at) : <span className="text-muted-foreground">Never</span>}
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
                          <DropdownMenuItem onClick={() => setTarget(k)}>
                            <Trash2 className="size-4" /> Revoke
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o && !revoking) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {target ? deviceOf(target) : ''}?</DialogTitle>
            <DialogDescription>
              Lightroom Classic on that computer is signed out and can no longer publish. Galleries already
              published stay online.
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

function GalleryRow({ g, now }: { g: Gallery; now: number }) {
  const [copied, setCopied] = useState(false);
  const state = linkState(g, now);
  const url = g.share?.url ?? null;
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link', 'Open it instead and copy it from the address bar.');
    }
  };
  return (
    <tr className="border-t align-top" data-testid="lr-gallery-row">
      <td className="px-4 py-3">
        <div className="font-medium">{g.title}</div>
        <div className="text-xs text-muted-foreground">{plural(g.item_count, 'photo', 'photos')}</div>
      </td>
      <td className="px-4 py-3 text-xs">
        {g.selections_enabled ? (
          <>
            <div>{plural(g.client_count, 'client', 'clients')}</div>
            <div className="text-muted-foreground">{plural(g.selection_count, 'selection', 'selections')}</div>
          </>
        ) : (
          <span className="text-muted-foreground">Selections off</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-start gap-1.5">
          <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', DOT[state.tone])} />
          <span>{state.text}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        {/* No link to copy or open once the link row is gone: publish again
            from Lightroom Classic to give the gallery a new one. */}
        {url && (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" onClick={copy} aria-label={`Copy link for ${g.title}`}>
              <CopyCheck copied={copied} className="size-3.5" /> Copy
            </Button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${g.title}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
            >
              <ExternalLink className="size-4" />
            </a>
          </div>
        )}
      </td>
    </tr>
  );
}

function GalleriesCard() {
  const activeId = useWorkspace((s) => s.activeId);
  const [galleries, setGalleries] = useState<Gallery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!activeId) return;
    let alive = true;
    setGalleries(null);
    setError(null);
    // The list is paged (newest first); follow next_cursor, bounded.
    const loadAll = async () => {
      const base = `/api/galleries?workspace_id=${encodeURIComponent(activeId)}`;
      const all: Gallery[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const r: { galleries: Gallery[]; next_cursor?: string | null } =
          await api(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base);
        all.push(...r.galleries);
        cursor = r.next_cursor ?? null;
        if (!cursor) break;
      }
      return all;
    };
    loadAll()
      .then((list) => { if (alive) setGalleries(list); })
      .catch((e) => { if (alive) setError(errorMessage(e, 'Could not load your galleries. Please try again.')); });
    return () => { alive = false; };
  }, [activeId]);

  const loading = Boolean(activeId) && galleries === null && error === null;

  return (
    <section className="mb-6 rounded-xl border bg-card">
      <div className="px-4 py-3">
        <h2 className="text-sm font-semibold">Galleries</h2>
        <p className="text-xs text-muted-foreground">In the active workspace. Publish and edit them from Lightroom Classic.</p>
      </div>
      {error && <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">{error}</p>}
      {loading && (
        <div className="border-t px-4 py-3" data-testid="lr-gallery-skeleton"><Skeleton className="h-4 w-48" /></div>
      )}
      {galleries !== null && galleries.length === 0 && (
        <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
          No galleries yet. Publish a collection from Lightroom Classic and it shows up here.
        </p>
      )}
      {galleries !== null && galleries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-t">
                <th className="px-4 py-2 font-medium">Gallery</th>
                <th className="px-4 py-2 font-medium">Clients</th>
                <th className="px-4 py-2 font-medium">Link</th>
                <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {galleries.map((g) => <GalleryRow key={g.id} g={g} now={now} />)}
            </tbody>
          </table>
        </div>
      )}
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
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function SetupCard() {
  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold">Set up Lightroom Classic</h2>
      <div className="grid gap-5 sm:grid-cols-3">
        <RailStep n={1} title="Download">
          <p className="mb-2">Get the plug-in and unzip it somewhere it can stay.</p>
          <a
            href={LIGHTROOM_PLUGIN_URL}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
          >
            <Download className="size-3.5" /> Download plug-in
          </a>
        </RailStep>
        <RailStep n={2} title="Add it">
          In Lightroom Classic, open File › Plug-in Manager, choose Add and select the unzipped
          dosya.lrplugin folder.
        </RailStep>
        <RailStep n={3} title="Connect">
          In the plug-in, choose Connect. Your browser opens here, you compare the code and allow it.
          Your dosya password is never typed into Lightroom.
        </RailStep>
      </div>
    </section>
  );
}

export default function LightroomSetup() {
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <ConnectionsCard />
      <GalleriesCard />
      <SetupCard />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Clients never need a dosya account to view a gallery.</span>
        <Link to="/billing" className="underline underline-offset-2 hover:text-foreground">
          What each plan includes
        </Link>
      </p>
    </IntegrationLayout>
  );
}

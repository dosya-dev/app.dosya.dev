import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, FolderOpen, Loader2, MoreVertical, Unplug } from 'lucide-react';
import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { formatExactDateTime } from '@/lib/date-format';
import { humanSizeShort, timeAgo } from '@/lib/helpers';
import { getIntegration, WORDPRESS_ZIP_URL } from '@/lib/integrations';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

const meta = getIntegration('wordpress')!;

/** Sites are few; the page asks for each one's backups, so it stops here. */
const MAX_SITES = 20;

interface WpCaps { sites_max: number | null; retention_days_max: number; immutability_hours_max: number }
interface WpSite {
  id: string;
  name: string;
  site_url: string;
  status: 'active' | 'clone_suspected' | 'disconnected';
  root_folder_id?: string | null;
}
interface WpBackup {
  id: string;
  kind: 'full' | 'incremental';
  state: 'running' | 'uploaded' | 'verified' | 'failed' | 'skipped' | 'expired';
  bytes_new: number;
  bytes_total: number;
  locked_until: number | null;
  created_at: number;
  completed_at: number | null;
}
/** null = the backups request for this site failed. */
type SiteBackups = WpBackup[] | null;

/*
 * Sites-first page for the WordPress plugin: what is connected, when it last
 * backed up, whether the newest backup is still locked, and how to add one.
 *
 * No ApiKeyCallout: the plugin never asks for a pasted key. "Connect to
 * dosya" in wp-admin sends the reader to /connect/wordpress, where they pick
 * a workspace and press Allow, and the site receives its own wp_site key
 * from that exchange. Telling them to make a key here would leave a spare
 * full-scope key lying around for nothing.
 *
 * The zip link exists only because the plugin is not on WordPress.org yet.
 * When the listing is approved, replace the primary Download with "View on
 * WordPress.org" and WORDPRESS_ZIP_URL can go.
 */

/** Read straight from error-copy (this page's test mocks the client down to api + ApiError). */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string; message?: string };
      if (parsed.message) return parsed.message;
      if (parsed.error) return humanizeApiError(parsed.error);
    } catch { /* non-JSON body */ }
    if (err.body && !err.body.trimStart().startsWith('<')) return err.body;
    return `Request failed (${err.status}). Please try again.`;
  }
  return 'Could not load your WordPress sites. Please try again.';
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function planLine(count: number, caps: WpCaps): string {
  const head = caps.sites_max === null
    ? `${count} ${plural(count, 'site', 'sites')}`
    : `${count} of ${caps.sites_max} on your plan`;
  return `${head} · ${caps.retention_days_max}-day retention · ${caps.immutability_hours_max} h protection`;
}

type Tone = 'green' | 'amber' | 'grey';
const DOT: Record<Tone, string> = { green: 'bg-green-500', amber: 'bg-amber-500', grey: 'bg-muted-foreground' };

function lastBackupCell(backups: SiteBackups): { main: string; sub: string | null } {
  if (backups === null) return { main: 'Unknown', sub: null };
  const b = backups[0];
  if (!b) return { main: 'None yet', sub: null };
  if (b.state === 'running') return { main: 'Uploading…', sub: null };
  const when = timeAgo(b.completed_at ?? b.created_at);
  if (b.state === 'failed') return { main: 'Failed', sub: when };
  const detail = b.kind === 'full'
    ? `full, ${humanSizeShort(b.bytes_total)}`
    : `incremental, ${humanSizeShort(b.bytes_new)} new`;
  return { main: when, sub: detail };
}

function statusCell(site: WpSite, backups: SiteBackups, now: number): { text: string; tone: Tone } {
  if (site.status === 'clone_suspected') return { text: 'Copy detected, check the site', tone: 'amber' };
  if (backups === null) return { text: 'Unknown', tone: 'grey' };
  if (backups.length === 0) return { text: 'No backup yet', tone: 'grey' };
  if (backups[0].state === 'failed') return { text: 'Last backup failed', tone: 'amber' };
  const lock = Math.max(0, ...backups.map((b) => b.locked_until ?? 0));
  if (lock > now) return { text: `Protected until ${formatExactDateTime(lock)}`, tone: 'green' };
  return { text: 'Connected', tone: 'green' };
}

function DownloadButton() {
  return (
    <a href={WORDPRESS_ZIP_URL} download className={cn(buttonVariants(), 'h-9 gap-2 px-4')}>
      <Download className="size-4" />
      Download dosya-backup.zip
    </a>
  );
}

function SiteRow({
  site, backups, now, onDisconnect,
}: { site: WpSite; backups: SiteBackups | undefined; now: number; onDisconnect: (s: WpSite) => void }) {
  const loaded = backups !== undefined;
  const last = lastBackupCell(backups ?? null);
  const status = statusCell(site, backups ?? null, now);
  const stored = backups?.find((b) => b.state === 'uploaded' || b.state === 'verified');
  return (
    <tr className="border-t align-top" data-testid="wp-site-row">
      <td className="px-4 py-3">
        <div className="font-medium">{site.name}</div>
        <div className="text-xs text-muted-foreground">{hostOf(site.site_url)}</div>
      </td>
      <td className="px-4 py-3">
        <div>{last.main}</div>
        {last.sub && <div className="text-xs text-muted-foreground">{last.sub}</div>}
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {loaded && stored ? humanSizeShort(stored.bytes_total) : <span className="text-muted-foreground">{loaded ? (backups === null ? 'Unknown' : 'None') : ''}</span>}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-start gap-1.5">
          <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', DOT[status.tone])} />
          <span>{status.text}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {site.root_folder_id && (
            <Link
              to={`/files?folder=${encodeURIComponent(site.root_folder_id)}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
            >
              <FolderOpen /> Open folder
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${site.name}`}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }))}
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDisconnect(site)}>
                <Unplug className="size-4" /> Disconnect
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
        <tr key={i} className="border-t" data-testid="wp-site-skeleton">
          <td className="px-4 py-3"><Skeleton className="h-4 w-32" /><Skeleton className="mt-1.5 h-3 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-14" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
          <td className="px-4 py-3"><Skeleton className="ml-auto h-7 w-28" /></td>
        </tr>
      ))}
    </>
  );
}

function SitesCard({ onLoaded }: { onLoaded: (hasSites: boolean) => void }) {
  const [sites, setSites] = useState<WpSite[] | null>(null);
  const [caps, setCaps] = useState<WpCaps | null>(null);
  const [backups, setBackups] = useState<Record<string, SiteBackups>>({});
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<WpSite | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const inFlight = useRef(false);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ sites: WpSite[]; caps: WpCaps }>('/api/wp/sites');
        const list = res.sites.slice(0, MAX_SITES);
        const results = await Promise.all(list.map(async (s): Promise<[string, SiteBackups]> => {
          try {
            const r = await api<{ backups: WpBackup[] }>(`/api/wp/sites/${encodeURIComponent(s.id)}/backups`);
            return [s.id, r.backups];
          } catch {
            return [s.id, null];
          }
        }));
        if (cancelled) return;
        setBackups(Object.fromEntries(results));
        setCaps(res.caps);
        setSites(list);
        setTotal(res.sites.length);
        onLoaded(list.length > 0);
      } catch (e) {
        if (!cancelled) { setError(errorMessage(e)); onLoaded(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [onLoaded]);

  const confirmDisconnect = useCallback(async () => {
    if (!target || inFlight.current) return;
    const site = target;
    inFlight.current = true;
    setDisconnecting(true);
    try {
      await api(`/api/wp/sites/${encodeURIComponent(site.id)}/disconnect`, { method: 'POST' });
      setSites((cur) => (cur ? cur.filter((s) => s.id !== site.id) : cur));
      setTotal((t) => Math.max(0, t - 1));
      onLoaded(sites ? sites.length > 1 : true);
      toast.success('Site disconnected', `${site.name} is no longer connected. Its backups are kept.`);
      setTarget(null);
    } catch (e) {
      toast.error('Disconnect failed', errorMessage(e));
    } finally {
      inFlight.current = false;
      setDisconnecting(false);
    }
  }, [target, sites, onLoaded]);

  const loading = sites === null && error === null;
  const empty = sites !== null && sites.length === 0;

  return (
    <section className="mb-6 rounded-xl border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
        <h2 className="text-sm font-semibold">Your WordPress sites</h2>
        {sites && caps && !empty && <p className="text-xs text-muted-foreground">{planLine(total, caps)}</p>}
      </div>

      {error && <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">{error}</p>}

      {empty && (
        <div className="space-y-3 border-t px-4 py-6 text-center">
          <p className="text-sm font-medium">No WordPress site connected yet.</p>
          <div className="flex justify-center"><DownloadButton /></div>
          <p className="text-sm text-muted-foreground">
            Install it on your site, then press Connect to dosya in wp-admin.
          </p>
        </div>
      )}

      {!error && !empty && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-t">
                <th className="px-4 py-2 font-medium">Site</th>
                <th className="px-4 py-2 font-medium">Last backup</th>
                <th className="px-4 py-2 font-medium">Stored</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows />}
              {sites?.map((s) => (
                <SiteRow key={s.id} site={s} backups={backups[s.id]} now={now} onDisconnect={setTarget} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && !empty && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          {sites !== null && sites.length < total && <span className="mb-1 block">Showing {sites.length} of {total} sites.</span>}
          Backups are ordinary files in WordPress Backups. Restore from wp-admin; this page never deletes a locked backup.
        </p>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => { if (!o && !disconnecting) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {target?.name}?</DialogTitle>
            <DialogDescription>
              Disconnect {target?.name} from dosya? Backups already stored in dosya are kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={disconnecting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDisconnect} disabled={disconnecting}>
              {disconnecting && <Loader2 className="size-4 animate-spin" />}
              Disconnect
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

function AddSiteCard({ title }: { title: string }) {
  return (
    <section className="mb-6 rounded-xl border bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      <div className="grid gap-5 sm:grid-cols-3">
        <RailStep n={1} title="Install">
          <a href={WORDPRESS_ZIP_URL} download className="underline underline-offset-2 hover:text-foreground">
            Download the zip
          </a>{' '}
          and upload it under Plugins › Add New › Upload Plugin. WordPress 6.0 or later, PHP 7.4 or later. Once the
          plugin is listed on WordPress.org you can search for dosya Backup there instead.
        </RailStep>
        <RailStep n={2} title="Connect">
          In wp-admin press Connect to dosya; you come back here, pick the workspace and press Allow. The site
          gets its own key that can only write to its backup folder and can never delete a backup.
        </RailStep>
        <RailStep n={3} title="Back up">
          The first backup is full; after that only what changed is uploaded. Backups land in a WordPress Backups
          folder in that workspace.
        </RailStep>
      </div>
    </section>
  );
}

export default function WordPressSetup() {
  // The empty state already carries the download button, so the card is "Add a site" there.
  const [hasSites, setHasSites] = useState(true);
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      <SitesCard onLoaded={setHasSites} />
      <AddSiteCard title={hasSites ? 'Add another site' : 'Add a site'} />
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Restoring is free at any size.</span>
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
        >
          Plugin docs <ExternalLink className="size-3" />
        </a>
        <Link to="/billing" className="underline underline-offset-2 hover:text-foreground">
          What each plan includes
        </Link>
      </p>
    </IntegrationLayout>
  );
}

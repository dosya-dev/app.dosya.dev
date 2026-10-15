// apps/web/src/pages/connect/wordpress.tsx
import { useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { PublicNav } from '@/components/public-nav';
import { Logo } from '@/components/brand/logo';
import { rememberPostAuthPath } from '@/lib/post-auth-path';
import { useWorkspace } from '@/stores/workspace';

interface WpCaps { sites_max: number | null; retention_days_max: number; immutability_hours_max: number }
interface WpSite { id: string; status?: string }
interface WorkspaceRow { id: string; name: string }

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
  return 'Could not connect the site. Please try again.';
}

function parseHttpUrl(value: string): URL | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * The only place this page ever navigates to: same host (and port) as the
 * site being connected, under /wp-admin/. Anything else is refused.
 */
function validateReturn(returnUrl: string, siteUrl: string): URL | null {
  const ret = parseHttpUrl(returnUrl);
  const site = parseHttpUrl(siteUrl);
  if (!ret || !site) return null;
  if (ret.protocol !== site.protocol || ret.host !== site.host) return null;
  // a subdirectory install (https://shop.test/blog) keeps its wp-admin under that path
  const base = site.pathname.replace(/\/+$/, '');
  if (!ret.pathname.startsWith(`${base}/wp-admin/`)) return null;
  return ret;
}

function withParams(base: URL, extra: Record<string, string>): string {
  const u = new URL(base.toString());
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

function capsLine(planName: string, caps: WpCaps): string {
  const sites = caps.sites_max === null ? 'unlimited sites' : `${caps.sites_max} site${caps.sites_max === 1 ? '' : 's'}`;
  return `${planName} plan: ${sites}, ${caps.retention_days_max} days retention, ${caps.immutability_hours_max} h immutability`;
}

/**
 * /connect/wordpress - the consent page the dosya WordPress plugin opens.
 * The query carries the site identity, the plugin's PKCE challenge and CSRF
 * state, and the wp-admin address to come back to. The API validates every
 * field again; this page additionally refuses any `return` that is not on the
 * site's own host under the site's own /wp-admin/, so a crafted link cannot carry the
 * one-time code anywhere else.
 */
export default function ConnectWordPressPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const selectId = useId();
  const activeId = useWorkspace((s) => s.activeId);

  const siteUrl = params.get('site_url') ?? '';
  const homeUrl = params.get('home_url') ?? '';
  const name = params.get('name') ?? '';
  const fingerprint = params.get('fingerprint') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const state = params.get('state') ?? '';
  const returnParam = params.get('return') ?? '';
  const multisite = ['1', 'true'].includes(params.get('multisite') ?? '');

  const site = parseHttpUrl(siteUrl);
  const complete = Boolean(site && parseHttpUrl(homeUrl) && name && fingerprint && codeChallenge && state && returnParam);
  const returnUrl = useMemo(() => (complete ? validateReturn(returnParam, siteUrl) : null), [complete, returnParam, siteUrl]);

  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [planName, setPlanName] = useState('Free');
  const [caps, setCaps] = useState<WpCaps | null>(null);
  const [connected, setConnected] = useState(0);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [capHit, setCapHit] = useState(false);

  const toLogin = () => {
    rememberPostAuthPath(`${location.pathname}${location.search}`);
    navigate('/login');
  };

  useEffect(() => {
    if (!complete || !returnUrl) return;
    let alive = true;
    (async () => {
      try {
        const [ws, me, sites] = await Promise.all([
          api<{ ok: boolean; workspaces: WorkspaceRow[] }>('/api/workspaces'),
          api<{ ok: boolean; user?: { plan?: { name: string } | null } | null }>('/api/me'),
          api<{ sites: WpSite[]; caps: WpCaps }>('/api/wp/sites'),
        ]);
        if (!alive) return;
        setWorkspaces(ws.workspaces);
        setPlanName(me.user?.plan?.name ?? 'Free');
        setCaps(sites.caps);
        setConnected(sites.sites.filter((s) => s.status !== 'disconnected').length);
      } catch (e: unknown) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
        setError(errorMessage(e));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, returnUrl]);

  const selected = chosen || (workspaces?.some((w) => w.id === activeId) ? activeId : workspaces?.[0]?.id ?? '');
  const atCap = capHit || (caps !== null && caps.sites_max !== null && connected >= caps.sites_max);
  const ready = workspaces !== null && caps !== null && Boolean(selected);

  const allow = async () => {
    if (!returnUrl) return;
    setBusy(true); setError('');
    try {
      const res = await api<{ ok: boolean; code: string; state: string }>('/api/wp/connect/authorize', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: selected, site_url: siteUrl, home_url: homeUrl, name, fingerprint, multisite,
          code_challenge: codeChallenge, state,
        }),
      });
      if (!res.code || res.state !== state) {
        setError('The connection response did not match this request. Nothing was connected.');
        setBusy(false);
        return;
      }
      // Always the validated return, with the state this page was given.
      window.location.assign(withParams(returnUrl, { code: res.code, state }));
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
      if (e instanceof ApiError && e.status === 402) setCapHit(true);
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!returnUrl) return;
    window.location.assign(withParams(returnUrl, { error: 'cancelled', state }));
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <Logo className="mb-6 h-8" />
        <Card className="w-full">
          <CardContent className="space-y-4 p-6">
            {!complete ? (
              <>
                <h1 className="text-xl font-semibold">This connect request is incomplete</h1>
                <p className="text-sm text-muted-foreground">
                  Start the connection from the dosya Backup page in your WordPress admin, not from a bookmark.
                </p>
              </>
            ) : !returnUrl ? (
              <>
                <h1 className="text-xl font-semibold">This connect request was refused</h1>
                <p className="text-sm text-muted-foreground">
                  The return address must be a /wp-admin/ page on {site!.host}. This link points somewhere else, so nothing was connected.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">Connect {site!.host} to dosya</h1>
                <p className="text-sm text-muted-foreground">
                  Allow {name} ({site!.host}) to store its backups in your dosya account. It gets a key limited to one
                  folder, <span className="whitespace-nowrap">WordPress Backups</span>, and cannot see anything else.
                </p>
                <div className="space-y-1.5">
                  <label htmlFor={selectId} className="text-sm font-medium">Save backups in workspace</label>
                  <select
                    id={selectId}
                    value={selected}
                    onChange={(e) => setChosen(e.target.value)}
                    disabled={busy || workspaces === null}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {(workspaces ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                {workspaces !== null && workspaces.length === 0 && (
                  <p role="alert" className="text-sm text-destructive">
                    You have no workspace to save backups in. <Link to="/" className="underline underline-offset-2">Create one in dosya</Link> first.
                  </p>
                )}
                {caps && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>{capsLine(planName, caps)}</p>
                    {caps.sites_max !== null && <p>{Math.min(connected, caps.sites_max)} of {caps.sites_max} sites connected</p>}
                  </div>
                )}
                {atCap && (
                  <p role="alert" className="text-sm text-destructive">
                    Your plan's connected site limit is reached.{' '}
                    <Link to="/pricing" className="underline underline-offset-2">See plans</Link> to connect more sites.
                  </p>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={allow} disabled={busy || !ready || atCap} className="flex-1">
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Allow
                  </Button>
                  <Button variant="outline" onClick={cancel} disabled={busy}>Cancel</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

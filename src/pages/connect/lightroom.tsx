// apps/web/src/pages/connect/lightroom.tsx
import { useEffect, useId, useState } from 'react';
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

interface WorkspaceRow { id: string; name: string }
interface ConnectRequest {
  device_name: string;
  plugin_version: string | null;
  created_at: number;
  expires_at: number;
  status: string;
}
type Outcome = 'allowed' | 'denied' | null;

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
  return 'Could not complete the request. Please try again.';
}

/** Why a request cannot be approved any more, or null while it can. */
function deadReason(req: ConnectRequest, now: number): string | null {
  if (req.status === 'pending') return req.expires_at <= now ? 'This request has expired.' : null;
  if (req.status === 'expired') return 'This request has expired.';
  if (req.status === 'denied') return 'This request was already denied.';
  return 'This request was already used.';
}

/**
 * /connect/lightroom - the approval page the dosya Lightroom Classic plug-in
 * opens. The plug-in shows the same code in its own dialog; comparing the two
 * is what stops a stranger's link from connecting your catalog. The plug-in
 * polls for the key, so this page never receives or shows one.
 */
export default function ConnectLightroomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const selectId = useId();
  const activeId = useWorkspace((s) => s.activeId);
  const code = (params.get('code') ?? '').trim().toUpperCase();

  const [request, setRequest] = useState<ConnectRequest | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [now] = useState(() => Math.floor(Date.now() / 1000));

  const toLogin = () => {
    rememberPostAuthPath(`${location.pathname}${location.search}`);
    navigate('/login');
  };

  useEffect(() => {
    if (!code) return;
    let alive = true;
    (async () => {
      try {
        const [req, ws] = await Promise.all([
          api<{ ok: boolean; request: ConnectRequest }>(`/api/lightroom/connect/request?code=${encodeURIComponent(code)}`),
          api<{ ok: boolean; workspaces: WorkspaceRow[] }>('/api/workspaces'),
        ]);
        if (!alive) return;
        setRequest(req.request);
        setWorkspaces(ws.workspaces);
      } catch (e: unknown) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) {
          setRequest({ device_name: '', plugin_version: null, created_at: 0, expires_at: 0, status: 'expired' });
          return;
        }
        setError(errorMessage(e));
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const selected = chosen || (workspaces?.some((w) => w.id === activeId) ? activeId : workspaces?.[0]?.id ?? '');
  const dead = request ? deadReason(request, now) : null;

  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(decision); setError('');
    try {
      await api('/api/lightroom/connect/decide', {
        method: 'POST',
        body: JSON.stringify({ code, workspace_id: selected, decision }),
      });
      setOutcome(decision === 'allow' ? 'allowed' : 'denied');
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const workspaceName = workspaces?.find((w) => w.id === selected)?.name ?? '';

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <Logo className="mb-6 h-8" />
        <Card className="w-full">
          <CardContent className="space-y-4 p-6">
            {!code ? (
              <>
                <h1 className="text-xl font-semibold">This connect request is incomplete</h1>
                <p className="text-sm text-muted-foreground">
                  Start the connection from the dosya plug-in in Lightroom Classic, not from a bookmark.
                </p>
              </>
            ) : outcome === 'allowed' ? (
              <>
                <h1 className="text-xl font-semibold">Return to Lightroom Classic</h1>
                <p className="text-sm text-muted-foreground">
                  {request?.device_name || 'Lightroom Classic'} is connected{workspaceName ? ` to ${workspaceName}` : ''}.
                  The plug-in picks this up on its own, so you can close this tab.
                </p>
              </>
            ) : outcome === 'denied' ? (
              <>
                <h1 className="text-xl font-semibold">Connection denied</h1>
                <p className="text-sm text-muted-foreground">Nothing was connected. You can close this tab.</p>
              </>
            ) : !request ? (
              error
                ? <p role="alert" className="text-sm text-destructive">{error}</p>
                : <p className="text-sm text-muted-foreground">Loading the request...</p>
            ) : dead ? (
              <>
                <h1 className="text-xl font-semibold">{dead}</h1>
                <p className="text-sm text-muted-foreground">
                  Choose Connect again in the dosya plug-in in Lightroom Classic to get a fresh code.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">Connect Lightroom Classic to dosya</h1>
                <p className="text-sm text-muted-foreground">
                  Allow <span className="font-medium text-foreground">{request.device_name}</span>
                  {request.plugin_version ? ` (plug-in ${request.plugin_version})` : ''} to publish galleries
                  to your dosya account. It gets its own key, which you can revoke at any time.
                </p>
                <p data-testid="lr-scope" className="text-sm text-muted-foreground">
                  It can upload, read, change, delete and share files in{' '}
                  <span className="font-medium text-foreground">{workspaceName || 'the workspace you pick'}</span>,
                  and change that workspace&apos;s settings that your role allows.
                </p>
                <p data-testid="lr-warning" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                  Only allow this if you just chose Connect in Lightroom Classic on your own computer.
                  If someone sent you this link, choose Deny.
                </p>
                <div className="rounded-lg bg-muted px-4 py-3 text-center">
                  <p className="text-xs text-muted-foreground">Make sure this matches the code in Lightroom Classic</p>
                  <p data-testid="lr-code" className="mt-1 font-mono text-2xl font-semibold tracking-widest">{code}</p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor={selectId} className="text-sm font-medium">Publish galleries to workspace</label>
                  <select
                    id={selectId}
                    value={selected}
                    onChange={(e) => setChosen(e.target.value)}
                    disabled={busy !== null || workspaces === null}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {(workspaces ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">You need permission to upload and share in the workspace you pick.</p>
                </div>
                {workspaces !== null && workspaces.length === 0 && (
                  <p role="alert" className="text-sm text-destructive">
                    You have no workspace to publish to. <Link to="/" className="underline underline-offset-2">Create one in dosya</Link> first.
                  </p>
                )}
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={() => decide('allow')} disabled={busy !== null || !request || !selected} className="flex-1">
                    {busy === 'allow' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Allow
                  </Button>
                  <Button variant="outline" onClick={() => decide('deny')} disabled={busy !== null || !request}>
                    {busy === 'deny' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Deny
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

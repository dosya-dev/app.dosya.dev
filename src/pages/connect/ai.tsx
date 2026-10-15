// apps/web/src/pages/connect/ai.tsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { api, ApiError, API_BASE } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rememberPostAuthPath } from '@/lib/post-auth-path';
import { AI_BRAND_MARKS, isAiBrand } from '@/lib/ai-brands';
import { Check, Lock, Monitor, ShieldCheck, TriangleAlert, X } from 'lucide-react';

/** What GET /api/oauth/consent returns. Every client string is untrusted:
 *  it comes from the app's own registration, so it renders as text only. */
interface ConsentView {
  client: {
    name: string; domain: string | null; redirectHost: string; redirectIsLoopback: boolean;
    /** Set by the API only for an app verified by its callback host. */
    brand?: string | null;
    by?: string | null;
  };
  scopes: { id: string; required: boolean }[];
  workspaces: { id: string; name: string }[];
}

const SCOPE_LABELS: Record<string, string> = {
  'files.read': 'Read files and folders',
  'account.read': 'See your plan and storage',
};

/** The authorization server's origin. In dev the API sits behind the Vite
 *  proxy on this origin; everywhere else it is api.dosya.dev. */
function apiOrigin(): string {
  return API_BASE ? new URL(API_BASE).origin : window.location.origin;
}

/** A resume target must be our own /authorize, or this page becomes an
 *  open redirector for anyone who can craft a link to it. */
function isOurAuthorizeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.origin === apiOrigin() && u.pathname === '/authorize';
  } catch {
    return false;
  }
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 410) return 'This request expired. Go back to your AI app and connect again.';
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error) return humanizeApiError(parsed.error);
    } catch { /* non-JSON body */ }
    return `Request failed (${err.status}). Please try again.`;
  }
  return 'Could not connect the app. Please try again.';
}

/**
 * /connect/ai - the consent page for connecting an AI assistant (Claude,
 * ChatGPT, or any MCP client) to one workspace, read-only.
 *
 * Two entries, both from api.dosya.dev/authorize:
 *  - `?resume=<authorize url>`: the person was not signed in. Sign in, then
 *    go back to /authorize, which now finds the session.
 *  - `?handle=<h>`: the request is validated and waiting. Show who is asking,
 *    let the person pick the workspace, and post the decision back.
 */
export default function ConnectAiPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const resume = params.get('resume') ?? '';
  const handle = params.get('handle') ?? '';

  const [view, setView] = useState<ConsentView | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [optional, setOptional] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);

  const toLogin = () => {
    rememberPostAuthPath(`${location.pathname}${location.search}`);
    navigate('/login');
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (resume) {
        if (!isOurAuthorizeUrl(resume)) { setInvalid(true); return; }
        try {
          await api('/api/me');
          if (!cancelled) window.location.assign(resume);
        } catch (e) {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 401) toLogin();
          else setError(errorText(e));
        }
        return;
      }
      if (!handle) { setInvalid(true); return; }
      try {
        const res = await api<{ ok: boolean; consent: ConsentView; account?: { email?: string } }>(`/api/oauth/consent?handle=${encodeURIComponent(handle)}`);
        if (cancelled) return;
        setView(res.consent);
        setAccountEmail(res.account?.email ?? '');
        setWorkspaceId(res.consent.workspaces.length === 1 ? res.consent.workspaces[0].id : '');
        setOptional(Object.fromEntries(res.consent.scopes.filter((s) => !s.required).map((s) => [s.id, true])));
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) toLogin();
        else setError(errorText(e));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, handle]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (!view) return;
    setBusy(true); setError('');
    try {
      const scopes = Object.entries(optional).filter(([, kept]) => kept).map(([id]) => id);
      const res = await api<{ ok: boolean; redirect: string }>('/api/oauth/consent', {
        method: 'POST',
        body: JSON.stringify(decision === 'approve'
          ? { handle, decision, workspace_id: workspaceId, scopes }
          : { handle, decision }),
      });
      // The redirect must go where this page said access would go. Anything
      // else did not come from this request, and following it would hand a
      // live authorization code to a host the person never saw.
      // Hostname, not host: the library reports redirectHost without the
      // port, and loopback clients (local MCP apps) always carry one.
      let host = '';
      try { host = new URL(res.redirect).hostname; } catch { /* malformed */ }
      if (host !== view.client.redirectHost) {
        setError('The server returned an unexpected destination');
        setBusy(false);
        return;
      }
      window.location.assign(res.redirect);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
      setError(errorText(e));
      setBusy(false);
    }
  };

  const body = () => {
    if (invalid) {
      return (
        <>
          <h1 className="text-xl font-semibold">That link is not valid</h1>
          <p className="text-sm text-muted-foreground">Start connecting again from your AI app.</p>
        </>
      );
    }
    if (!view) {
      return error
        ? <p role="alert" className="text-sm text-destructive">{error}</p>
        : <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
    }
    const c = view.client;
    const brand = isAiBrand(c.brand) ? c.brand : null;
    const mark = brand ? AI_BRAND_MARKS[brand] : null;
    // A verified app is named plainly; anything else keeps its self-declared
    // name in quotes, so it reads as a claim rather than an identity.
    const who = brand ? c.name : `\u201c${c.name}\u201d`;
    const chosen = view.workspaces.find((w) => w.id === workspaceId);
    return (
      <>
        <div className="flex items-center justify-center" aria-hidden="true">
          {mark ? (
            <span className="grid size-14 place-items-center rounded-2xl ring-1 ring-black/5 dark:ring-white/15" style={{ background: mark.tile }}>
              <svg viewBox="0 0 24 24" width="30" height="30"><path fill={mark.glyph} d={mark.path} /></svg>
            </span>
          ) : (
            <span className="grid size-14 place-items-center rounded-2xl border border-dashed border-muted-foreground/50 bg-muted">
              <Monitor className="size-7 text-muted-foreground" />
            </span>
          )}
          <span className="relative h-px w-16 border-t-2 border-dashed border-muted-foreground/40">
            <span className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-card">
              <Lock className="size-3.5 text-muted-foreground" />
            </span>
          </span>
          <span className="grid size-14 place-items-center rounded-2xl bg-[#18181b] ring-1 ring-black/5 dark:ring-white/15">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path fill="#fafafa" d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2l2.1 2.6h6.7A2.5 2.5 0 0 1 21 10.1v7.4A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
              <circle cx="16.6" cy="14.6" r="2.3" fill="#16a34a" />
            </svg>
          </span>
        </div>

        <h1 className="text-balance text-center text-xl font-semibold">{who} wants to read your dosya files</h1>

        <div className="flex justify-center">
          {brand ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-600/30 bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
              <ShieldCheck className="size-3.5" /> Verified: {c.redirectHost}{c.by ? ` \u00b7 by ${c.by}` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-3.5" /> Not verified {'\u00b7'} sends to {c.redirectHost}
            </span>
          )}
        </div>

        {c.redirectIsLoopback && (
          <div role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            This sends access to an app on your computer. Continue only if you just started connecting from it.
          </div>
        )}
        {!brand && !c.redirectIsLoopback && (
          <p className="text-center text-xs text-muted-foreground">
            {c.domain ? <>Published by <strong>{c.domain}</strong>. </> : 'This app registered itself, so its name is not verified. '}
            Continue only if you recognise it.
          </p>
        )}

        {view.workspaces.length === 0 ? (
          <p className="text-sm text-destructive">You have no workspace this app can read. End-to-end encrypted Spaces cannot be connected.</p>
        ) : (
          <div className="space-y-1 text-sm">
            <span className="font-medium">Workspace it can read</span>
            <Select
              value={workspaceId || null}
              onValueChange={(v) => setWorkspaceId(v ? String(v) : '')}
              disabled={busy}
              items={view.workspaces.map((w) => ({ value: w.id, label: w.name }))}
            >
              <SelectTrigger className="h-10 w-full text-sm" aria-label="Workspace it can read">
                <SelectValue placeholder="Choose a workspace" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {view.workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <ul className="space-y-2 text-sm">
          {view.scopes.map((s) => (
            <li key={s.id}>
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={s.required || optional[s.id] === true}
                  disabled={s.required || busy}
                  onChange={(e) => setOptional((o) => ({ ...o, [s.id]: e.target.checked }))}
                />
                <span>
                  {s.id === 'files.read' && chosen ? <>Find and read files in <strong>{chosen.name}</strong></> : (SCOPE_LABELS[s.id] ?? s.id)}
                </span>
              </label>
            </li>
          ))}
          <li className="flex items-start gap-2.5 text-muted-foreground"><X className="mt-0.5 size-4 shrink-0" /> Change, share or delete anything</li>
          <li className="flex items-start gap-2.5 text-muted-foreground"><X className="mt-0.5 size-4 shrink-0" /> Open your other workspaces or your Vault</li>
        </ul>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={() => decide('approve')} disabled={busy || !workspaceId} className="flex-1">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 size-4" />}
            Allow {brand ? c.name : ''}
          </Button>
          <Button variant="outline" onClick={() => decide('deny')} disabled={busy}>Deny</Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Access goes to <strong>{c.redirectHost}</strong>.
          {accountEmail ? <> Signed in as <strong>{accountEmail}</strong>.</> : null}
          {' '}Disconnect any time in Settings, Connected AI apps.
        </p>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <Card className="w-full">
          <CardContent className="space-y-5 p-6">{body()}</CardContent>
        </Card>
      </main>
    </div>
  );
}

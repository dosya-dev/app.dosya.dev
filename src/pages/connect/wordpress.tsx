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
import { t as translate, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

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
    return translate('common.error.requestFailedErrstatusPleaseTryAgain', { errStatus: err.status });
  }
  return translate('connect-wordpress.error.couldNotConnectTheSitePleaseTryAgain');
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
  const sites = caps.sites_max === null
    ? translate('connect-wordpress.label.unlimitedSites')
    : translate('connect-wordpress.description.capssitesMaxPluralOneSiteOtherSites', { capsSites_max: caps.sites_max });
  return translate('connect-wordpress.description.plannamePlanSitesCapsretentionDaysMaxDaysRetentionCapsimmutabilityHoursMaxHImmutability', {
    planName, sites, capsRetention_days_max: caps.retention_days_max, capsImmutability_hours_max: caps.immutability_hours_max,
  });
}

/** Keeps `phrase` on one line (the old page wrapped it in a nowrap span); the text is unchanged. */
function keepTogether(message: string, phrase: string) {
  const at = message.indexOf(phrase);
  if (at < 0) return message;
  return (
    <>
      {message.slice(0, at)}
      <span className="whitespace-nowrap">{phrase}</span>
      {message.slice(at + phrase.length)}
    </>
  );
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
  const t = useT();
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
  const [planNameSent, setPlanName] = useState<string | null>(null);
  // The server's plan name as sent; the "Free" fallback follows the language.
  const planName = planNameSent ?? t('common.label.free');
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
        setPlanName(me.user?.plan?.name ?? null);
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
        setError(t('connect-wordpress.error.theConnectionResponseDidNotMatchThisRequestNothingWasConnected'));
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
                <h1 className="text-xl font-semibold">{t('common.heading.thisConnectRequestIsIncomplete')}</h1>
                <p className="text-sm text-muted-foreground">
                  {t('connect-wordpress.description.startTheConnectionFromTheDosyaBackupPageInYourWordpress')}
                </p>
              </>
            ) : !returnUrl ? (
              <>
                <h1 className="text-xl font-semibold">{t('connect-wordpress.heading.thisConnectRequestWasRefused')}</h1>
                <p className="text-sm text-muted-foreground">
                  {t('connect-wordpress.error.theReturnAddressMustBeAWpAdminPageOnHostThis', { host: site!.host })}
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl font-semibold">{t('connect-wordpress.heading.connectHostToDosya', { host: site!.host })}</h1>
                <p className="text-sm text-muted-foreground">
                  {keepTogether(t('connect-wordpress.error.allowNameHostToStoreItsBackupsInYourDosyaAccount', { name, host: site!.host }), 'WordPress Backups')}
                </p>
                <div className="space-y-1.5">
                  <label htmlFor={selectId} className="text-sm font-medium">{t('connect-wordpress.label.saveBackupsInWorkspace')}</label>
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
                    {richText(t('connect-wordpress.description.youHaveNoWorkspaceToSaveBackupsInLink1First'), {
                      link1: <Link to="/" className="underline underline-offset-2">{t('common.action.createOneInDosya')}</Link>,
                    })}
                  </p>
                )}
                {caps && (
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>{capsLine(planName, caps)}</p>
                    {caps.sites_max !== null && <p>{t('connect-wordpress.label.connectedOfCapssitesMaxSitesConnected', { connected: Math.min(connected, caps.sites_max), capsSites_max: caps.sites_max })}</p>}
                  </div>
                )}
                {atCap && (
                  <p role="alert" className="text-sm text-destructive">
                    {richText(t('connect-wordpress.description.yourPlanSConnectedSiteLimitIsReachedLink1ToConnectMore'), {
                      link1: <Link to="/pricing" className="underline underline-offset-2">{t('common.action.seePlans')}</Link>,
                    })}
                  </p>
                )}
                {error && <p dir="auto" role="alert" className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button onClick={allow} disabled={busy || !ready || atCap} className="flex-1">
                    {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                    {t('common.action.allow')}
                  </Button>
                  <Button variant="outline" onClick={cancel} disabled={busy}>{t('common.cancel')}</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

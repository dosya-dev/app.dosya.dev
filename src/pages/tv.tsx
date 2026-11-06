// apps/web/src/pages/tv.tsx
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Loader2, MapPin, Tv } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/api/client';
import { humanizeApiError } from '@/api/error-copy';
import { PublicNav } from '@/components/public-nav';
import { Logo } from '@/components/brand/logo';
import { rememberPostAuthPath } from '@/lib/post-auth-path';
import { normalizeTvCode } from '@/lib/tv-code';
import { richText } from '@/lib/rich-text';
import { t as translate, useT } from '@/lib/i18n';

/** GET /api/auth/tv/lookup (docs/TV-API-CONTRACT.md §1). */
export interface TvLookup {
  user_code: string;
  device_type: string;
  device_model: string | null;
  location: string | null;
  expires_at: number;
}

/** Longest name the API stores for the session (contract: trimmed, at most 40 chars). */
const NAME_MAX = 40;

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; lookup: TvLookup }
  | { kind: 'gone' } // 404: unknown, expired or already used
  | { kind: 'decided' } // 409: someone already allowed or cancelled it
  | { kind: 'allowed' }
  | { kind: 'denied' }
  | { kind: 'failed'; message: string };

/** Read straight from error-copy (this page's test mocks the client down to api + ApiError). */
function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try {
      const parsed = JSON.parse(err.body) as { error?: string };
      if (parsed.error) return humanizeApiError(parsed.error);
    } catch { /* non-JSON body */ }
    if (err.body && !err.body.trimStart().startsWith('<')) return err.body;
    return translate('common.error.requestFailedErrstatusPleaseTryAgain', { errStatus: err.status });
  }
  return translate('common.description.networkErrorPleaseTryAgain');
}

/**
 * /tv - where a dosya TV app is signed in (RFC 8628 device flow). The TV's QR
 * code opens /tv?code=KDTR-9WMX; dosya.dev/tv, typed from the TV screen,
 * redirects to /tv and the code is entered here. Outside DashboardLayout like
 * the /connect pages: a signed-out visitor is sent through /login and brought
 * back with the code (lib/post-auth-path.ts).
 *
 * The code is shown again and the person is asked to compare it with the TV,
 * because a QR code someone else put in front of them would otherwise sign
 * THEIR TV into this account.
 */
export default function TvPage() {
  const t = useT();
  const [params] = useSearchParams();
  const raw = params.get('code') ?? '';
  const code = raw ? normalizeTvCode(raw) : null;

  return (
    <div className="min-h-screen bg-background">
      <PublicNav />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16">
        <Logo className="mb-6 h-8" />
        <Card className="w-full">
          <CardContent className="space-y-4 p-6">
            {code
              ? <Approve key={code} code={code} />
              : <EnterCode initial={raw} invalid={raw !== ''} t={t} />}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function EnterCode({ initial, invalid, t }: { initial: string; invalid: boolean; t: ReturnType<typeof useT> }) {
  const navigate = useNavigate();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState(initial);
  const [showError, setShowError] = useState(invalid);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeTvCode(value);
    if (!code) { setShowError(true); return; }
    navigate(`/tv?code=${encodeURIComponent(code)}`);
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-xl font-semibold">{t('connect-tv.heading.signInOnATv')}</h1>
      <p className="text-sm text-muted-foreground">{t('connect-tv.description.enterTheCodeShownOnYourTv')}</p>
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">{t('connect-tv.label.tvCode')}</label>
        <Input
          id={inputId}
          dir="ltr"
          value={value}
          onChange={(e) => { setValue(e.target.value); setShowError(false); }}
          placeholder="XXXX-XXXX"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={12}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          className="h-11 text-center font-mono text-lg tracking-widest uppercase"
          autoFocus
        />
        {showError && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {t('connect-tv.error.enterThe8CharacterCodeFromYourTv')}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full">{t('common.continue')}</Button>
    </form>
  );
}

function Approve({ code }: { code: string }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const nameId = useId();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState('');

  const toLogin = () => {
    rememberPostAuthPath(`${location.pathname}${location.search}`);
    navigate('/login');
  };

  useEffect(() => {
    // Starts in 'loading': a new code remounts this component (key={code}) and
    // Try again sets it before bumping the attempt.
    let alive = true;
    (async () => {
      try {
        const lookup = await api<TvLookup>(`/api/auth/tv/lookup?code=${encodeURIComponent(code)}`);
        if (!alive) return;
        setName(lookup.device_type);
        setView({ kind: 'ready', lookup });
      } catch (e: unknown) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
        if (e instanceof ApiError && e.status === 404) { setView({ kind: 'gone' }); return; }
        setView({ kind: 'failed', message: errorMessage(e) });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, attempt]);

  const decide = async (decision: 'allow' | 'deny') => {
    if (view.kind !== 'ready') return;
    setBusy(decision); setError('');
    const deviceName = name.trim().slice(0, NAME_MAX) || view.lookup.device_type;
    try {
      await api<{ ok: boolean }>('/api/auth/tv/approve', {
        method: 'POST',
        body: JSON.stringify(
          decision === 'allow'
            ? { user_code: code, decision, device_name: deviceName }
            : { user_code: code, decision },
        ),
      });
      setView({ kind: decision === 'allow' ? 'allowed' : 'denied' });
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
      if (e instanceof ApiError && e.status === 404) { setView({ kind: 'gone' }); return; }
      if (e instanceof ApiError && e.status === 409) { setView({ kind: 'decided' }); return; }
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  switch (view.kind) {
    case 'loading':
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('connect-tv.description.lookingUpTheCode')}
        </p>
      );
    case 'gone':
      return <Outcome title={t('connect-tv.description.thisCodeHasExpiredOrWasAlreadyUsed')} />;
    case 'decided':
      return <Outcome title={t('connect-tv.description.thisCodeWasAlreadyApprovedOrCancelled')} />;
    case 'allowed':
      return <Outcome title={t('connect-tv.heading.yourTvIsSignedIn')} body={t('connect-tv.description.youCanCloseThisPage')} />;
    case 'denied':
      return (
        <Outcome
          title={t('connect-tv.heading.tvSignInCancelled')}
          body={<>{t('connect-tv.description.weDidNotSignInTheTv')} {t('connect-tv.description.youCanCloseThisPage')}</>}
        />
      );
    case 'failed':
      return (
        <>
          <p dir="auto" role="alert" className="text-sm text-destructive">{view.message}</p>
          <Button variant="outline" onClick={() => { setView({ kind: 'loading' }); setAttempt((n) => n + 1); }}>{t('common.action.tryAgain')}</Button>
        </>
      );
    case 'ready': {
      const { lookup } = view;
      return (
        <>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">{t('connect-tv.heading.signInOnATvQuestion')}</h1>
            <p className="text-sm text-muted-foreground">{t('connect-tv.description.checkThisMatchesTheCodeOnYourTv')}</p>
          </div>
          <p dir="ltr" data-testid="tv-code" className="rounded-lg border bg-muted px-4 py-3 text-center font-mono text-3xl font-semibold tracking-widest">
            {lookup.user_code || code}
          </p>
          <div className="divide-y rounded-lg border">
            <Fact icon={<Tv className="h-5 w-5" aria-hidden="true" />} value={lookup.device_type} hint={t('connect-tv.label.deviceTypeReportedByTheTv')} />
            {lookup.location && (
              <Fact
                icon={<MapPin className="h-5 w-5" aria-hidden="true" />}
                value={t('connect-tv.label.nearLocation', { location: lookup.location })}
                hint={t('connect-tv.label.approximateLocation')}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">{t('connect-tv.label.nameThisTv')}</label>
            <Input
              id={nameId}
              dir="auto"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              disabled={busy !== null}
              className="h-10"
            />
          </div>
          <div data-testid="tv-warning" className="flex gap-3 rounded-lg border px-3 py-3 text-sm">
            <Eye className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>
              {richText(t('connect-tv.description.thisTvWillBeAbleToSeeAll'), {
                seeAllPhotosAndVideos: <strong className="font-semibold">{t('connect-tv.label.seeAllPhotosAndVideos')}</strong>,
              })}
            </p>
          </div>
          {error && <p dir="auto" role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col gap-2">
            <Button onClick={() => decide('allow')} disabled={busy !== null} className="h-10">
              {busy === 'allow' ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {t('common.action.allow')}
            </Button>
            <Button variant="outline" onClick={() => decide('deny')} disabled={busy !== null} className="h-10">
              {busy === 'deny' ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
              {t('common.cancel')}
            </Button>
          </div>
        </>
      );
    }
  }
}

function Fact({ icon, value, hint }: { icon: ReactNode; value: string; hint: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon}
      <div className="flex min-w-0 flex-col">
        <span dir="auto" className="truncate text-sm font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

function Outcome({ title, body }: { title: string; body?: ReactNode }) {
  return (
    <>
      <h1 className="text-xl font-semibold">{title}</h1>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
    </>
  );
}

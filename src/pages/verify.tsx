import { useState, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { API_BASE } from '@/api/client';
import { PublicNav } from '@/components/public-nav';
import { TurnstileWidget, type TurnstileHandle } from '@/components/turnstile-widget';
import { resolveTurnstileToken, turnstileFailureMessage, isTurnstileRejection } from '@/lib/turnstile-submit';
import { pendingPostAuthPath } from '@/lib/redemption-claim';
import { Logo } from "@/components/brand/logo";
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

export default function VerifyPage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!/^\d{6}$/.test(code)) { setError(t('verify.error.enterThe6DigitCodeFromYourEmail')); return; }
    setLoading(true);
    try {
      // Awaited, not read: typing six digits and hitting Enter is fast enough
      // to beat the challenge, and /api/auth/verify enforces.
      const challengeToken = await resolveTurnstileToken(turnstileRef.current);
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Turnstile-Token': challengeToken,
        },
        body: JSON.stringify(email ? { email, code } : { code }),
      });
      const data = await res.json();
      // Single-use token: reset on every outcome, not just failures, or a
      // retry after a wrong code fails verification instead.
      turnstileRef.current?.reset();
      if (res.ok && data.ok) navigate(pendingPostAuthPath() ?? data.redirect ?? '/create-workspace');
      else if (isTurnstileRejection(data)) setError(turnstileFailureMessage(turnstileRef.current));
      else setError(data.error ?? t('common.error.verificationFailed'));
    } catch {
      turnstileRef.current?.reset();
      setError(t('common.error.canTReachTheServerCheckYourConnectionAnd'));
    }
    setLoading(false);
  };

  const resend = async () => {
    setError(''); setInfo('');
    setResending(true);
    try {
      const challengeToken = await resolveTurnstileToken(turnstileRef.current);
      const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Turnstile-Token': challengeToken,
        },
        body: JSON.stringify(email ? { email } : {}),
      });
      const data = await res.json();
      // Single-use token: reset on every outcome, not just failures, or a
      // retry after a failed resend fails verification instead. Shares the
      // page's one widget with submit() - both routes serve the same
      // verify-your-email flow for the same user.
      turnstileRef.current?.reset();
      if (res.ok && data.ok) setInfo(t('verify.description.aNewCodeHasBeenSentToYourEmail'));
      else if (isTurnstileRejection(data)) setError(turnstileFailureMessage(turnstileRef.current));
      else setError(data.error ?? t('verify.error.couldNotResendCode'));
    } catch {
      turnstileRef.current?.reset();
      setError(t('common.error.canTReachTheServerCheckYourConnectionAnd'));
    }
    setResending(false);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ backgroundImage: 'url(/grid.svg)', backgroundRepeat: 'repeat' }}>
      <div className="p-4 sm:p-6 lg:p-8"><PublicNav cta="login" /></div>
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card>
            <CardContent className="pt-8 pb-6">
              <div className="text-center mb-8">
                <a href="/" className="inline-flex items-center gap-2 font-mono italic font-semibold text-lg">
                  <Logo className="h-7 w-7" />
                  dosya.dev
                </a>
                <h1 className="text-2xl font-bold mt-2">{t('common.heading.verifyYourEmail')}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {email
                    ? richText(
                        t('verify.description.weSentA6DigitCodeToEmail', { email: '{email}' }),
                        { email: <span className="font-medium text-foreground">{email}</span> },
                      )
                    : t('verify.description.enterThe6DigitCodeWeSentToYourEmail')}
                </p>
              </div>

              {error && <div dir="auto" className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}
              {info && <div className="bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 text-sm rounded-lg px-4 py-2.5 mb-4">{info}</div>}

              <form onSubmit={submit} className="space-y-4">
                <Input
                  value={code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  inputMode="numeric"
                  autoFocus
                  className="h-12 text-center text-2xl tracking-[10px] font-semibold"
                />
                <TurnstileWidget action="verify" ref={turnstileRef} />
                <Button type="submit" className="w-full h-10" disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin me-2" /> : null}
                  {t('common.action.verifyEmail')}
                </Button>
              </form>

              <div className="mt-6 text-center text-sm text-muted-foreground">
                {t('verify.description.didnTGetTheCode')}{' '}
                <button type="button" onClick={resend} disabled={resending} className="font-medium underline underline-offset-4 hover:text-foreground disabled:opacity-50">
                  {resending ? t('common.status.sending') : t('common.action.resendCode')}
                </button>
              </div>
              {/* Resending is not always the answer: a typo in the address or a
                  mail server that drops us needs a person, or a fresh start. */}
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {richText(t('verify.label.stillNothingLink1Link2', { link1: '{link1}', link2: '{link2}' }), {
                  link1: (
                    <a
                      href="https://dosya.dev/contact?topic=verification"
                      className="font-medium underline underline-offset-4 hover:text-foreground"
                    >
                      {t('common.action.contactSupport')}
                    </a>
                  ),
                  link2: (
                    <Link to="/sign-up" className="font-medium underline underline-offset-4 hover:text-foreground">
                      {t('verify.action.useADifferentEmail')}
                    </Link>
                  ),
                })}
              </p>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                <a href="/login" className="font-medium underline underline-offset-4 hover:text-foreground">{t('common.action.backToLogin')}</a>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

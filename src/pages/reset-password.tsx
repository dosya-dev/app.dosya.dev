import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { API_BASE } from '@/api/client';
import { PublicNav } from '@/components/public-nav';
import { PasswordStrengthMeter } from '@/components/password-strength-meter';
import { validatePassword } from '@/lib/validation-policy.generated';
import { translateExternal } from '@/lib/external-text';
import { TurnstileWidget, type TurnstileHandle } from '@/components/turnstile-widget';
import { resolveTurnstileToken, turnstileFailureMessage, isTurnstileRejection } from '@/lib/turnstile-submit';
import { Logo } from "@/components/brand/logo";
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';

/**
 * Reset tokens arrive in the URL fragment (`#token=…`) so they stay out of
 * browser history entries that sync across devices, server access logs, and
 * Referer headers. Links mailed before the switch still use `?token=`, so both
 * are read until those expire.
 */
function readResetToken(hash: string, searchParams: URLSearchParams): string {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  return fragment.get('token') ?? searchParams.get('token') ?? '';
}

export default function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token] = useState(() => readResetToken(window.location.hash, searchParams));

  // Drop the token from the address bar once it is in memory, so it is not
  // left sitting in the URL for a shoulder-surfer or a screenshot.
  useEffect(() => {
    if (!token) return;
    if (window.location.hash || searchParams.has('token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    // Runs once - `token` is captured at mount and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw !== confirm) { setError(t('reset-password.error.passwordsDoNotMatch')); return; }
    // All four clauses, not just length - the API applies the same function, so
    // a password rejected here would have been rejected there with this exact
    // sentence.
    const passwordError = validatePassword(newPw);
    if (passwordError) { setError(translateExternal(passwordError, 'error')); return; }
    setLoading(true);
    try {
      const challengeToken = await resolveTurnstileToken(turnstileRef.current);
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Turnstile-Token': challengeToken,
        },
        body: JSON.stringify({ token, new_password: newPw }),
      });
      const data = await res.json();
      // Single-use token: reset on every outcome, not just failures, or a
      // retry fails verification instead.
      turnstileRef.current?.reset();
      // An account with a second factor enrolled gets a 2FA challenge from the
      // reset, not a session (same cookie and page as login). Sending them to
      // /login would make them type the brand-new password straight back in.
      if (res.ok && data.ok) navigate(data.requires_2fa ? '/login/2fa' : '/login?reset=1');
      else if (isTurnstileRejection(data)) setError(turnstileFailureMessage(turnstileRef.current));
      else setError(data.error ?? t('reset-password.error.couldNotResetPassword'));
    } catch {
      turnstileRef.current?.reset();
      setError(t('common.error.networkError'));
    }
    setLoading(false);
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
                <h1 className="text-2xl font-bold mt-2">{t('common.heading.setANewPassword')}</h1>
                <p className="text-sm text-muted-foreground mt-1">{t('reset-password.description.chooseAStrongPasswordForYourAccount')}</p>
              </div>

              {!token ? (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-3 text-center">
                  {richText(t('reset-password.error.missingOrInvalidResetLinkPleaseUseTheLinkFromYour', { link1: '{link1}' }), {
                    link1: <a href="/forgot-password" className="font-medium underline underline-offset-4">{t('reset-password.action.requestANewOne')}</a>,
                  })}
                </div>
              ) : (
                <>
                  {error && <div dir="auto" className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="new-password" className="text-sm font-medium">{t('common.label.newPassword')}</label>
                      <div className="relative">
                        <Input id="new-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={newPw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPw(e.target.value)} required autoFocus className="h-10 pe-10" />
                        <button type="button" tabIndex={-1} onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t('common.accessibility.hidePassword') : t('common.accessibility.showPassword')} className="absolute inset-y-0 inset-e-0 flex items-center justify-center w-10 text-muted-foreground hover:text-foreground transition-colors">
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      <PasswordStrengthMeter password={newPw} />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="confirm-password" className="text-sm font-medium">{t('forgot-password.label.confirmPassword')}</label>
                      <Input id="confirm-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} required className="h-10" onKeyDown={(e) => e.key === 'Enter' && submit(e)} />
                    </div>
                    <TurnstileWidget action="reset-password" ref={turnstileRef} />
                    <Button type="submit" className="w-full h-10" disabled={loading}>
                      {loading ? <Loader2 className="size-4 animate-spin me-2" /> : null}
                      {t('forgot-password.action.resetPassword')}
                    </Button>
                  </form>
                </>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                <a href="/login" className="font-medium underline underline-offset-4 hover:text-foreground">{t('common.action.backToLogin')}</a>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Loader2, ArrowLeft } from 'lucide-react';
import { pendingPostAuthPath } from '@/lib/redemption-claim';
import { consumePostAuthPath } from '@/lib/post-auth-path';
import { useT } from '@/lib/i18n';

export default function Login2faPage() {
  const t = useT();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleVerify = async () => {
    const value = showRecovery ? recoveryCode.trim() : code.trim();
    if (!value) { setError(t('two-factor.error.enterACode')); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await api<{ ok: boolean; redirect?: string; error?: string }>('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify(showRecovery ? { code: value, is_recovery: true } : { code: value }),
      });
      if (res.ok) {
        navigate(pendingPostAuthPath() ?? consumePostAuthPath() ?? res.redirect ?? '/');
      } else {
        setError(res.error ?? t('common.error.verificationFailed'));
      }
    } catch (e: unknown) {
      try {
        const body = JSON.parse(e && typeof e === 'object' && 'body' in e && typeof e.body === 'string' ? e.body : '{}') as { error?: string };
        setError(body.error || t('common.error.verificationFailed'));
      } catch {
        setError(t('common.error.verificationFailed'));
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <Card className="gap-0 py-0 p-8 shadow-sm">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Lock className="size-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold">{t('common.heading.twoFactorAuthentication')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {showRecovery ? t('two-factor.label.enterARecoveryCode') : t('two-factor.label.enterThe6DigitCodeToContinue')}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mb-4">
              {error}
            </div>
          )}

          {/* Code form */}
          {!showRecovery ? (
            <div className="space-y-4">
              <Input
                type="text"
                value={code}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-2xl tracking-[0.3em] font-mono h-12"
                autoFocus
              />
              <Button className="w-full" onClick={handleVerify} disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin me-1.5" />}
                {t('two-factor.action.verify')}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('two-factor.label.recoveryCode')}</Label>
                <Input
                  type="text"
                  value={recoveryCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecoveryCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                  placeholder={t('two-factor.placeholder.xxxxXxxx')}
                  maxLength={9}
                  autoComplete="off"
                  className="font-mono"
                  autoFocus
                />
              </div>
              <Button className="w-full" onClick={handleVerify} disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin me-1.5" />}
                {t('two-factor.action.useRecoveryCode')}
              </Button>
            </div>
          )}

          {/* Toggle */}
          <div className="text-center mt-4">
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => { setShowRecovery(!showRecovery); setError(''); }}
            >
              {showRecovery ? t('two-factor.action.useAuthenticatorCode') : t('two-factor.action.useARecoveryCodeInstead')}
            </button>
          </div>

          {/* Back */}
          <div className="text-center mt-3">
            <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="size-3 rtl:-scale-x-100" /> {t('common.action.backToLogin')}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

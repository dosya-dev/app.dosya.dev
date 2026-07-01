import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Loader2, ArrowLeft } from 'lucide-react';

export default function Login2faPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleVerify = async () => {
    const value = showRecovery ? recoveryCode.trim() : code.trim();
    if (!value) { setError('Enter a code'); return; }
    setError('');
    setSubmitting(true);
    try {
      const res = await api<{ ok: boolean; redirect?: string; error?: string }>('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify(showRecovery ? { code: value, is_recovery: true } : { code: value }),
      });
      if (res.ok) {
        navigate(res.redirect || '/');
      } else {
        setError(res.error ?? 'Verification failed');
      }
    } catch (e: any) {
      try {
        const body = JSON.parse(e.body || '{}');
        setError(body.error || 'Verification failed');
      } catch {
        setError('Verification failed');
      }
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border bg-card p-8 shadow-sm">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="size-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Lock className="size-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-bold">Two-factor authentication</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {showRecovery ? 'Enter a recovery code' : 'Enter the 6-digit code to continue'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mb-4">
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
                {submitting && <Loader2 className="size-4 animate-spin mr-1.5" />}
                Verify
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Recovery code</label>
                <Input
                  type="text"
                  value={recoveryCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecoveryCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
                  placeholder="XXXX-XXXX"
                  maxLength={9}
                  autoComplete="off"
                  className="font-mono"
                  autoFocus
                />
              </div>
              <Button className="w-full" onClick={handleVerify} disabled={submitting}>
                {submitting && <Loader2 className="size-4 animate-spin mr-1.5" />}
                Use recovery code
              </Button>
            </div>
          )}

          {/* Toggle */}
          <div className="text-center mt-4">
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => { setShowRecovery(!showRecovery); setError(''); }}
            >
              {showRecovery ? 'Use authenticator code' : 'Use a recovery code instead'}
            </button>
          </div>

          {/* Back */}
          <div className="text-center mt-3">
            <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="size-3" /> Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

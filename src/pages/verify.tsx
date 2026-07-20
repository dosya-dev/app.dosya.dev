import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { API_BASE } from '@/api/client';
import { PublicNav } from '@/components/public-nav';

export default function VerifyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setInfo('');
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your email.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email ? { email, code } : { code }),
      });
      const data = await res.json();
      if (res.ok && data.ok) navigate(data.redirect ?? '/create-workspace');
      else setError(data.error ?? 'Verification failed');
    } catch { setError("Can't reach the server. Check your connection and try again."); }
    setLoading(false);
  };

  const resend = async () => {
    setError(''); setInfo('');
    setResending(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(email ? { email } : {}),
      });
      const data = await res.json();
      if (res.ok && data.ok) setInfo('A new code has been sent to your email.');
      else setError(data.error ?? 'Could not resend code');
    } catch { setError("Can't reach the server. Check your connection and try again."); }
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
                  <img src="/logo.svg" alt="dosya.dev logo" className="h-7 w-7" />
                  dosya.dev
                </a>
                <h1 className="text-2xl font-bold mt-2">Verify your email</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter the 6-digit code we sent{email ? <> to <span className="font-medium text-foreground">{email}</span></> : ' to your email'}.
                </p>
              </div>

              {error && <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}
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
                <Button type="submit" className="w-full h-10" disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                  Verify email
                </Button>
              </form>

              <div className="mt-6 text-center text-sm text-muted-foreground">
                Didn't get it?{' '}
                <button type="button" onClick={resend} disabled={resending} className="font-medium underline underline-offset-4 hover:text-foreground disabled:opacity-50">
                  {resending ? 'Sending…' : 'Resend code'}
                </button>
              </div>
              <p className="mt-2 text-center text-sm text-muted-foreground">
                <a href="/login" className="font-medium underline underline-offset-4 hover:text-foreground">Back to login</a>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

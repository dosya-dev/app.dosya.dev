import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, MailCheck } from 'lucide-react';
import { API_BASE } from '@/api/client';
import { PublicNav } from '@/components/public-nav';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.ok) setSent(true);
      else setError(data.error ?? 'Could not send reset link');
    } catch { setError('Network error'); }
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
                  <img src="/logo.svg" alt="dosya.dev logo" className="h-7 w-7" />
                  dosya.dev
                </a>
                <h1 className="text-2xl font-bold mt-2">Reset your password</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your account email and we'll send you a reset link.
                </p>
              </div>

              {sent ? (
                <div className="text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                    <MailCheck className="size-6 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    If an account exists for <span className="font-medium text-foreground">{email}</span>, a password reset link is on its way. Check your inbox (and spam).
                  </p>
                </div>
              ) : (
                <>
                  {error && <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="email" className="text-sm font-medium">Email</label>
                      <Input id="email" type="email" placeholder="name@example.com" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required autoFocus className="h-10" />
                    </div>
                    <Button type="submit" className="w-full h-10" disabled={loading}>
                      {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                      Send reset link
                    </Button>
                  </form>
                </>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                Remembered it? <a href="/login" className="font-medium underline underline-offset-4 hover:text-foreground">Back to login</a>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

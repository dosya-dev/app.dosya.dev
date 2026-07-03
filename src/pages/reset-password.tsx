import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { API_BASE } from '@/api/client';
import { PublicNav } from '@/components/public-nav';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPw !== confirm) { setError('Passwords do not match.'); return; }
    if (newPw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: newPw }),
      });
      const data = await res.json();
      if (res.ok && data.ok) navigate('/login?reset=1');
      else setError(data.error ?? 'Could not reset password');
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
                <h1 className="text-2xl font-bold mt-2">Set a new password</h1>
                <p className="text-sm text-muted-foreground mt-1">Choose a strong password for your account.</p>
              </div>

              {!token ? (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-3 text-center">
                  Missing or invalid reset link. Please use the link from your email, or{' '}
                  <a href="/forgot-password" className="font-medium underline underline-offset-4">request a new one</a>.
                </div>
              ) : (
                <>
                  {error && <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">{error}</div>}
                  <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="new-password" className="text-sm font-medium">New password</label>
                      <div className="relative">
                        <Input id="new-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={newPw} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPw(e.target.value)} required autoFocus className="h-10 pr-10" />
                        <button type="button" tabIndex={-1} onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-muted-foreground hover:text-foreground transition-colors">
                          {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="confirm-password" className="text-sm font-medium">Confirm password</label>
                      <Input id="confirm-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••" value={confirm} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)} required className="h-10" onKeyDown={(e) => e.key === 'Enter' && submit(e)} />
                    </div>
                    <Button type="submit" className="w-full h-10" disabled={loading}>
                      {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                      Reset password
                    </Button>
                  </form>
                </>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                <a href="/login" className="font-medium underline underline-offset-4 hover:text-foreground">Back to login</a>
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

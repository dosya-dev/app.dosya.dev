import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { API_BASE } from '@/api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        navigate(data.redirect ?? '/');
      } else {
        setError(data.error ?? 'Sign-in failed');
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  };

  const handleGoogle = () => { window.location.href = `${API_BASE}/api/auth/google`; };
  const handleGithub = () => { window.location.href = `${API_BASE}/api/auth/github`; };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardContent className="pt-8 pb-6">
            <div className="text-center mb-8">
              <a href="/" className="text-lg font-bold tracking-tight">dosya.dev</a>
              <h1 className="text-2xl font-bold mt-2">Welcome back</h1>
              <p className="text-sm text-muted-foreground mt-1">Enter your credentials to access your account</p>
            </div>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">
                {error}
              </div>
            )}

            <div className="space-y-3 mb-6">
              <Button variant="outline" className="w-full h-11 text-sm font-medium gap-2" onClick={handleGoogle}>
                <svg className="size-5" viewBox="0 0 16 16" fill="none"><path d="M8 6.54541V9.6436H12.3054C12.1164 10.64 11.549 11.4836 10.6981 12.0509L13.2945 14.0655C14.8072 12.6691 15.68 10.6182 15.68 8.18185C15.68 7.61459 15.6291 7.06908 15.5345 6.5455L8 6.54541Z" fill="#4285F4"/><path d="M3.51576 9.52246L2.93018 9.97071L0.857422 11.5852C2.17378 14.1961 4.87176 15.9998 7.99901 15.9998C10.159 15.9998 11.9698 15.287 13.2935 14.0653L10.6972 12.0507C9.98443 12.5307 9.07533 12.8216 7.99901 12.8216C5.91902 12.8216 4.1518 11.418 3.51903 9.52708L3.51576 9.52246Z" fill="#34A853"/><path d="M0.858119 4.41455C0.312695 5.49087 0 6.70543 0 7.99996C0 9.29448 0.312695 10.509 0.858119 11.5854C0.858119 11.5926 3.51998 9.51991 3.51998 9.51991C3.35998 9.03991 3.26541 8.53085 3.26541 7.99987C3.26541 7.46889 3.35998 6.95984 3.51998 6.47984L0.858119 4.41455Z" fill="#FBBC05"/><path d="M7.99918 3.18545C9.17737 3.18545 10.2246 3.59271 11.061 4.37818L13.3519 2.0873C11.9628 0.792777 10.1592 0 7.99918 0C4.87193 0 2.17378 1.79636 0.857422 4.41455L3.5192 6.48001C4.15189 4.58908 5.91919 3.18545 7.99918 3.18545Z" fill="#EA4335"/></svg>
                Continue with Google
              </Button>
              <Button variant="outline" className="w-full h-11 text-sm font-medium gap-2 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleGithub}>
                <svg className="size-5" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                Continue with GitHub
              </Button>
            </div>

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or</span></div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input id="email" type="email" placeholder="name@example.com" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} required className="h-10" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium">Password</label>
                  <a href="/forgot-password" className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline">Forgot password?</a>
                </div>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)} required className="h-10" />
              </div>
              <Button type="submit" className="w-full h-10" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Log In
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Don't have an account? <a href="/sign-up" className="font-medium underline underline-offset-4 hover:text-foreground">Sign up</a>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

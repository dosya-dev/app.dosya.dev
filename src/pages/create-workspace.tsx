import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, LogOut } from 'lucide-react';
import { useWorkspace } from '@/stores/workspace';

const COLORS = [
  { value: '#22c55e', label: 'Green' },
  { value: '#7C3AED', label: 'Purple' },
  { value: '#2563EB', label: 'Blue' },
  { value: '#EA580C', label: 'Orange' },
  { value: '#059669', label: 'Teal' },
  { value: '#DB2777', label: 'Pink' },
  { value: '#1A1917', label: 'Black' },
];

export default function CreateWorkspacePage() {
  const navigate = useNavigate();
  const setActiveId = useWorkspace((s: { setActiveId: (id: string) => void }) => s.setActiveId);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#22c55e');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const preview = name.trim()
    ? name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Workspace name is required'); return; }
    setError('');
    setCreating(true);

    try {
      const res = await api<{ ok: boolean; workspace?: { id: string }; error?: string }>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), icon_color: color }),
      });
      if (res.ok && res.workspace) {
        setActiveId(res.workspace.id);
        navigate('/');
      } else {
        setError(res.error ?? 'Failed to create workspace');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setCreating(false);
  };

  const logout = async () => {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <img src="/logo.svg" alt="dosya.dev" className="h-7 w-7" />
          <span className="font-semibold font-mono italic text-lg">dosya.dev</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <h1 className="text-xl font-bold text-center mb-2">Create your workspace</h1>
            <p className="text-sm text-muted-foreground text-center mb-6">
              A workspace is where your files, folders, and team live. You need at least one to get started.
            </p>

            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name with preview */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Workspace name</label>
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 transition-colors"
                    style={{ background: color }}
                  >
                    {preview}
                  </div>
                  <Input
                    value={name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                    placeholder="e.g. My Files, Work, School..."
                    maxLength={80}
                    autoFocus
                    className="h-10"
                  />
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Color</label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setColor(c.value)}
                      className={`w-7 h-7 rounded-lg transition-all ${color === c.value ? 'ring-2 ring-offset-2 ring-foreground' : ''}`}
                      style={{ background: c.value }}
                      aria-label={c.label}
                    />
                  ))}
                </div>
              </div>

              <Button type="submit" className="w-full h-10" disabled={creating}>
                {creating ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Create workspace
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Bottom actions */}
        <div className="flex items-center justify-center gap-4 mt-6">
          <button onClick={logout} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <LogOut className="size-3.5" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

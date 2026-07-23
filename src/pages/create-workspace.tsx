import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_BASE, ApiError, apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Loader2, LogOut, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
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

interface Workspace {
  id: string; name: string; icon_initials: string; icon_color: string;
  icon_image_url?: string | null; role_id?: string;
}

export default function CreateWorkspacePage() {
  const navigate = useNavigate();
  const setActiveId = useWorkspace((s: { setActiveId: (id: string) => void }) => s.setActiveId);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'select' | 'create'>('create');

  const [name, setName] = useState('');
  const [color, setColor] = useState('#22c55e');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Load the user's existing workspaces — if they have any, default to the picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces');
        if (res.ok && res.workspaces.length > 0) {
          setWorkspaces(res.workspaces);
          setMode('select');
        }
      } catch { /* fall back to create */ }
      setLoading(false);
    })();
  }, []);

  const preview = name.trim()
    ? name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const selectWorkspace = (id: string) => {
    setActiveId(id);
    navigate('/');
  };

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
    } catch (err) {
      // api() throws ApiError on any non-2xx, so the server's own message
      // (plan limit, duplicate slug, validation) surfaces here — the generic
      // copy is reserved for real connectivity failures.
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Your session has expired. Please sign in again.'
          : apiErrorMessage(err, "Can't reach the server. Check your connection and try again."),
      );
    }
    setCreating(false);
  };

  const logout = async () => {
    await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/login';
  };

  const showPicker = mode === 'select' && workspaces.length > 0;

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
            {loading ? (
              <div className="py-12 flex items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : showPicker ? (
              <>
                <h1 className="text-xl font-bold text-center mb-2">Choose a workspace</h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                  Pick a workspace to continue, or create a new one.
                </p>

                <div className="space-y-2 mb-4">
                  {workspaces.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => selectWorkspace(w.id)}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg border hover:bg-muted/50 transition-colors text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden" style={{ background: w.icon_image_url ? undefined : w.icon_color }}>
                        {w.icon_image_url ? <img src={w.icon_image_url} alt="" className="w-full h-full object-cover" /> : w.icon_initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{w.name}</p>
                        <p className="text-[11px] text-muted-foreground capitalize">{w.role_id === 'owner' ? 'Owner' : 'Member'}</p>
                      </div>
                      <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => { setMode('create'); setError(''); }}
                  className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Plus className="size-4" /> Create new workspace
                </button>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold text-center mb-2">
                  {workspaces.length > 0 ? 'Create a new workspace' : 'Create your workspace'}
                </h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                  A workspace is where your files, folders, and team live.
                  {workspaces.length === 0 && ' You need at least one to get started.'}
                </p>

                {error && (
                  <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg px-4 py-2.5 mb-4">
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-2 block">Workspace name</Label>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 transition-colors" style={{ background: color }}>
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

                  <div>
                    <Label className="text-xs font-medium text-muted-foreground mb-2 block">Color</Label>
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

                {workspaces.length > 0 && (
                  <button
                    onClick={() => { setMode('select'); setError(''); }}
                    className="w-full flex items-center justify-center gap-1.5 mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronLeft className="size-3.5" /> Back to your workspaces
                  </button>
                )}
              </>
            )}
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

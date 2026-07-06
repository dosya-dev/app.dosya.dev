import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Lock, Unlock, Eye, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';

interface LockModalProps {
  open: boolean;
  target: { id: string; name: string; type: 'file' | 'folder' } | null;
  onClose: () => void;
  onDone: () => void;
}

type LockMode = 'none' | 'view_only' | 'full_lock';

const MODES: { value: LockMode; label: string; desc: string; icon: React.ReactNode }[] = [
  { value: 'none', label: 'Unlocked', desc: 'Full access for all members', icon: <Unlock className="size-4 text-green-600" /> },
  { value: 'view_only', label: 'View only', desc: 'Can preview, no download or edit', icon: <Eye className="size-4 text-blue-600" /> },
  { value: 'full_lock', label: 'Full lock', desc: 'Password required to access', icon: <Lock className="size-4 text-violet-600" /> },
];

export function LockModal({ open, target, onClose, onDone }: LockModalProps) {
  const [mode, setMode] = useState<LockMode>('none');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !target) return;
    setPassword('');
    setError('');
    setFetching(true);
    const ep = target.type === 'file' ? `/api/files/${target.id}/lock` : `/api/folders/${target.id}/lock`;
    api<{ ok: boolean; lock_mode: string }>(ep)
      .then((data) => { if (data.ok) setMode((data.lock_mode ?? 'none') as LockMode); })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [open, target]);

  const handleSubmit = async () => {
    if (!target) return;
    if (mode === 'full_lock' && password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    setError('');
    setLoading(true);
    const ep = target.type === 'file' ? `/api/files/${target.id}/lock` : `/api/folders/${target.id}/lock`;
    try {
      const body: Record<string, unknown> = { lock_mode: mode };
      if (mode === 'full_lock') body.password = password;
      const res = await api<{ ok: boolean; error?: string }>(ep, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(mode === 'none' ? 'File unlocked' : 'File locked', mode === 'none' ? 'This file is now unlocked.' : `Lock mode set to ${mode.replace('_', ' ')}.`);
        onDone();
        onClose();
      } else {
        setError(res.error ?? 'Failed');
      }
    } catch {
      setError('Failed to update lock');
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Lock {target?.type}</DialogTitle>
        </DialogHeader>

        {fetching ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as LockMode)}>
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 px-3 py-3 rounded-lg border cursor-pointer transition-colors ${mode === m.value ? 'border-foreground bg-muted/50' : 'hover:bg-muted/30'}`}
                >
                  <RadioGroupItem value={m.value} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {m.icon} {m.label}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>

            {mode === 'full_lock' && (
              <div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  placeholder="Enter lock password (min 4 chars)"
                  className="h-8 text-xs w-full"
                  autoFocus
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading || fetching}>
            {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
            {mode === 'none' ? 'Remove lock' : 'Apply lock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

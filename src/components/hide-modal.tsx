import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Eye, EyeOff, UserMinus, Shield, Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';

interface HideModalProps {
  open: boolean;
  target: { id: string; name: string; type: 'file' | 'folder' } | null;
  onClose: () => void;
  onDone: () => void;
}

type HiddenMode = 'none' | 'everyone' | 'users' | 'roles';

interface Member { id: string; name: string; email: string }
interface Role { id: string; name: string }

export function HideModal({ open, target, onClose, onDone }: HideModalProps) {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [mode, setMode] = useState<HiddenMode>('none');
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !target) return;
    setError('');
    setFetching(true);

    const ep = target.type === 'file' ? `/api/files/${target.id}/hide` : `/api/folders/${target.id}/hide`;

    Promise.all([
      api<{ ok: boolean; hidden_mode?: string; rules?: { target_id: string }[] }>(ep),
      api<{ ok: boolean; members?: Member[] }>(`/api/team?workspace_id=${wsId}`),
      api<{ ok: boolean; roles?: Role[] }>(`/api/roles?workspace_id=${wsId}`),
    ]).then(([hideData, teamData, rolesData]) => {
      if (hideData.ok) {
        setMode((hideData.hidden_mode ?? 'none') as HiddenMode);
        setSelectedTargets(new Set((hideData.rules ?? []).map((r) => r.target_id)));
      }
      if (teamData.ok && teamData.members) setMembers(teamData.members);
      if (rolesData.ok && rolesData.roles) setRoles(rolesData.roles);
    }).catch(() => {}).finally(() => setFetching(false));
  }, [open, target, wsId]);

  const toggleTarget = (id: string) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!target) return;
    setError('');
    setLoading(true);
    const ep = target.type === 'file' ? `/api/files/${target.id}/hide` : `/api/folders/${target.id}/hide`;
    try {
      const body: Record<string, unknown> = { hidden_mode: mode };
      if (mode === 'users' || mode === 'roles') {
        if (selectedTargets.size === 0) {
          setError(`Select at least one ${mode === 'users' ? 'user' : 'role'}.`);
          setLoading(false);
          return;
        }
        body.targets = Array.from(selectedTargets);
      }
      const res = await api<{ ok: boolean; error?: string }>(ep, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(mode === 'none' ? 'File unhidden' : 'File hidden', mode === 'none' ? 'This file is now visible to everyone.' : 'This file is now hidden.');
        onDone();
        onClose();
      } else {
        setError(res.error ?? 'Failed');
      }
    } catch {
      setError('Failed to update visibility');
    }
    setLoading(false);
  };

  const MODES: { value: HiddenMode; label: string; desc: string; icon: React.ReactNode }[] = [
    { value: 'none', label: 'Visible', desc: 'Everyone can see this', icon: <Eye className="size-4 text-muted-foreground" /> },
    { value: 'everyone', label: 'Hidden from everybody', desc: 'Only you can see this', icon: <EyeOff className="size-4 text-red-500" /> },
    { value: 'users', label: 'Hidden from specific users', desc: 'Select which users can\'t see this', icon: <UserMinus className="size-4 text-blue-500" /> },
    { value: 'roles', label: 'Hidden from specific roles', desc: 'Select which roles can\'t see this', icon: <Shield className="size-4 text-violet-500" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Hide {target?.type}</DialogTitle>
        </DialogHeader>

        {fetching ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            {MODES.map((m) => (
              <label
                key={m.value}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${mode === m.value ? 'border-foreground bg-muted/50' : 'hover:bg-muted/30'}`}
              >
                <input type="radio" name="hidden_mode" value={m.value} checked={mode === m.value} onChange={() => { setMode(m.value); setSelectedTargets(new Set()); }} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">{m.icon} {m.label}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                </div>
              </label>
            ))}

            {/* User picker */}
            {mode === 'users' && (
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No members found</p>
                ) : members.map((m) => (
                  <button
                    key={m.id}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs border-b last:border-b-0 hover:bg-muted/50 text-left ${selectedTargets.has(m.id) ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                    onClick={() => toggleTarget(m.id)}
                  >
                    {selectedTargets.has(m.id) && <Check className="size-3 text-blue-600 shrink-0" />}
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-muted-foreground truncate">{m.email}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Role picker */}
            {mode === 'roles' && (
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {roles.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">No roles found</p>
                ) : roles.map((r) => (
                  <button
                    key={r.id}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs border-b last:border-b-0 hover:bg-muted/50 text-left ${selectedTargets.has(r.id) ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}
                    onClick={() => toggleTarget(r.id)}
                  >
                    {selectedTargets.has(r.id) && <Check className="size-3 text-violet-600 shrink-0" />}
                    <span className="flex-1 truncate">{r.name}</span>
                  </button>
                ))}
              </div>
            )}

            {(mode === 'users' || mode === 'roles') && selectedTargets.size > 0 && (
              <p className="text-xs text-muted-foreground">{selectedTargets.size} selected</p>
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
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

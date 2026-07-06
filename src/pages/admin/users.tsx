import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Ban, Shield, Loader2, CreditCard } from 'lucide-react';
import { timeAgo, avatarColor, initials } from '@/lib/helpers';
import { toast } from '@/lib/toast';

interface User { id: string; name: string; email: string; plan: string; created_at: number; is_banned?: number; login_method?: string }

const PLAN_OPTIONS = [
  { value: '', label: 'Select plan' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'plus', label: 'Plus' },
  { value: 'pro', label: 'Pro' },
  { value: 'business', label: 'Business' },
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionModal, setActionModal] = useState<{ userId: string; action: string; userName: string } | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    api<{ ok: boolean; users: User[] }>('/api/admin')
      .then((d) => { if (d.ok) setUsers(d.users); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const doAction = async () => {
    if (!actionModal) return;
    setActing(true);
    try {
      const body: Record<string, unknown> = { user_id: actionModal.userId, action: actionModal.action };
      if (actionModal.action === 'ban') body.reason = actionInput;
      if (actionModal.action === 'change_plan') body.plan = actionInput;
      const res = await api<{ ok: boolean; error?: string }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
      if (res.ok) { toast.success('User updated', 'The change has been applied.'); setActionModal(null); }
      else toast.error('Update failed', res.error ?? 'The user could not be updated.');
    } catch { toast.error('Update failed', 'The user could not be updated.'); }
    setActing(false);
  };

  const filtered = search ? users.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())) : users;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold">Users ({users.length})</h1>
        <div className="relative w-56">
          <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Search users..." className="h-8 text-xs pl-8" />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <Card className="gap-0 py-0 overflow-hidden">
          {filtered.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-muted/50">
              <div className="size-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(u.id) }}>{initials(u.name)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.name}</p>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
              </div>
              <Badge variant="secondary" className="text-[9px]">{u.plan}</Badge>
              <span className="text-xs text-muted-foreground">{timeAgo(u.created_at)}</span>
              <div className="flex gap-1 shrink-0">
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setActionModal({ userId: u.id, action: 'ban', userName: u.name }); setActionInput(''); }}><Ban className="size-3" /></Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setActionModal({ userId: u.id, action: 'change_plan', userName: u.name }); setActionInput(''); }}><CreditCard className="size-3" /></Button>
                <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={() => { setActionModal({ userId: u.id, action: 'delete_sessions', userName: u.name }); setActionInput(''); }}><Shield className="size-3" /></Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Dialog open={!!actionModal} onOpenChange={() => setActionModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="capitalize">{actionModal?.action?.replace('_', ' ')} — {actionModal?.userName}</DialogTitle></DialogHeader>
          {actionModal?.action === 'ban' && <Input value={actionInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setActionInput(e.target.value)} placeholder="Ban reason" className="h-8 text-xs" />}
          {actionModal?.action === 'change_plan' && (
            <Select value={actionInput} onValueChange={(value) => setActionInput(value ?? '')} items={PLAN_OPTIONS}>
              <SelectTrigger className="h-8 text-xs border rounded-md px-2 bg-background w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLAN_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {actionModal?.action === 'delete_sessions' && <p className="text-sm text-muted-foreground">This will log out the user from all devices.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionModal(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doAction} disabled={acting}>{acting && <Loader2 className="size-4 animate-spin mr-1.5" />}Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


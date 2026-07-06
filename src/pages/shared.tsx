import { useState, useEffect, useCallback } from 'react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
// card unused for now but may be needed later
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, Copy, Check, X } from 'lucide-react';
import { humanSize, timeAgo, colorFor, labelFor } from '@/lib/helpers';
import { toast } from '@/lib/toast';

// ── Types ──────────────────────────────────────────────────

interface ShareLink {
  link_id: string; token: string; url: string;
  expires_at: number | null; view_count: number; download_count: number;
  is_revoked: number; shared_at: number; created_by: string;
  file_id: string; file_name: string; size_bytes: number;
  extension: string | null; region: string; sharer_name: string | null;
  status: string; is_mine: boolean;
}

type Filter = 'all' | 'active' | 'expiring' | 'expired' | 'revoked';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400',
  expiring: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  expired: 'bg-secondary text-muted-foreground',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};
const DOT_COLORS: Record<string, string> = { active: 'bg-green-500', expiring: 'bg-amber-500', expired: 'bg-muted-foreground', revoked: 'bg-red-500' };

function daysLeft(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'Expired';
  const d = Math.ceil(diff / 86400);
  return d === 1 ? '1d' : `${d}d`;
}

// ── Page ───────────────────────────────────────────────────

export default function SharedPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<ShareLink | null>(null);

  const load = useCallback(async () => {
    if (!wsId) return;
    try {
      const data = await api<{ ok: boolean; links: ShareLink[] }>(`/api/shares?workspace_id=${wsId}`);
      if (data.ok) setLinks(data.links);
    } catch { /* */ }
    setLoading(false);
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      const res = await api<{ ok: boolean }>(`/api/shares/${revokeTarget.link_id}/revoke`, { method: 'POST' });
      if (res.ok) {
        setLinks((prev) => prev.map((l) => l.link_id === revokeTarget.link_id ? { ...l, status: 'revoked', is_revoked: 1 } : l));
        toast.success('Link revoked', 'The share link no longer works.');
        setRevokeTarget(null);
      }
    } catch { toast.error('Revoke failed', 'The share link could not be revoked.'); }
  };

  // Filtered + searched
  const filtered = links
    .filter((l) => filter === 'all' || l.status === filter)
    .filter((l) => !search || l.file_name.toLowerCase().includes(search.toLowerCase()) || (l.sharer_name ?? '').toLowerCase().includes(search.toLowerCase()));

  // Stats
  const stats = {
    active: links.filter((l) => l.status === 'active').length,
    expiring: links.filter((l) => l.status === 'expiring').length,
    views: links.reduce((s, l) => s + l.view_count, 0),
    total: links.length,
  };
  const expiringSoon = links.filter((l) => l.status === 'expiring');

  const filters: { key: Filter; label: string; warn?: boolean }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'expiring', label: 'Expiring soon', warn: true },
    { key: 'expired', label: 'Expired' },
    { key: 'revoked', label: 'Revoked' },
  ];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-7 shrink-0">
          <h1 className="text-xl font-bold tracking-tight mb-4">Shared</h1>
          <Tabs value="by-me">
            <TabsList variant="line" className="w-full justify-start gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
              <TabsTrigger value="by-me" className="flex-none gap-0 rounded-none px-4 py-2.5 text-sm group-data-horizontal/tabs:after:-bottom-px">
                By me <Badge variant="default" className="ml-1.5 text-[10px]">{links.filter((l) => l.is_mine).length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="with-me" className="flex-none gap-0 rounded-none px-4 py-2.5 text-sm group-data-horizontal/tabs:after:-bottom-px">
                With me <Badge variant="secondary" className="ml-1.5 text-[10px]">—</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-8 py-3 border-b shrink-0">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`h-7 px-3 rounded-full text-xs font-medium border transition-colors ${filter === f.key ? 'bg-primary text-primary-foreground border-primary' : f.warn ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800' : 'bg-card border-border text-muted-foreground hover:bg-muted'}`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto" />
          <div className="relative">
            <Search className="size-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Filter by name or person..." className="h-8 text-xs pl-7 w-48" />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto px-8 pb-6">
          {loading ? (
            <div className="space-y-2 mt-4">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No shared links{filter !== 'all' ? ' with this status' : ''}</p>
          ) : (
            <Table className="mt-1">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['File', 'Region', 'Views', 'Expiry', 'Status', ''].map((h, i) => (
                    <TableHead key={h} className={`h-auto text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-2.5 px-2 ${i === 0 ? 'pl-0' : ''}`}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <ShareRow key={l.link_id} link={l} onRevoke={() => setRevokeTarget(l)} />
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="w-64 shrink-0 border-l overflow-y-auto hidden lg:block">
        {/* Overview */}
        <div className="p-5 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Overview</p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { value: stats.active, label: 'Active links' },
              { value: stats.views, label: 'Total views' },
              { value: stats.expiring, label: 'Expiring soon' },
              { value: stats.total, label: 'Total links' },
            ].map((s) => (
              <div key={s.label}>
                <p className="text-2xl font-semibold tracking-tight leading-none">{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Expiring soon */}
        <div className="p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Expiring soon</p>
          {expiringSoon.length === 0 ? (
            <p className="text-xs text-muted-foreground">None</p>
          ) : expiringSoon.map((l) => (
            <div key={l.link_id} className="flex items-center gap-2 mb-2.5">
              <div className="w-7 h-7 rounded-md flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ background: colorFor(l.file_name) }}>{labelFor(l.file_name)}</div>
              <span className="text-xs font-medium truncate flex-1">{l.file_name}</span>
              <span className="text-[11px] font-semibold text-amber-600">{l.expires_at ? daysLeft(l.expires_at) : '—'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Revoke dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent className="max-w-sm text-center">
          <DialogHeader><DialogTitle>Revoke share link</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Anyone with the link to <span className="font-semibold text-foreground">{revokeTarget?.file_name}</span> will lose access immediately. This cannot be undone.
          </p>
          <DialogFooter className="justify-center">
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRevoke}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Share Row ──────────────────────────────────────────────

function ShareRow({ link: l, onRevoke }: { link: ShareLink; onRevoke: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(l.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const expiryText = l.is_revoked ? 'Revoked' : (l.expires_at ? (l.status === 'expired' ? 'Expired' : daysLeft(l.expires_at)) : 'Never');
  const isLive = l.status === 'active' || l.status === 'expiring';

  return (
    <TableRow className="group">
      <TableCell className="py-3 pl-0 pr-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[8px] font-bold text-white shrink-0" style={{ background: colorFor(l.file_name) }}>{labelFor(l.file_name)}</div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate max-w-[200px]">{l.file_name}</p>
            <p className="text-[11px] text-muted-foreground">{humanSize(l.size_bytes)} · Shared {timeAgo(l.shared_at)}</p>
          </div>
        </div>
      </TableCell>
      <TableCell className="py-3 px-2"><Badge variant="secondary" className="text-[10px]">{l.region}</Badge></TableCell>
      <TableCell className="py-3 px-2">
        <p className="text-sm font-medium">{l.view_count}</p>
        <p className="text-[11px] text-muted-foreground">{l.download_count} download{l.download_count === 1 ? '' : 's'}</p>
      </TableCell>
      <TableCell className="py-3 px-2">
        <span className={`text-xs font-medium ${l.status === 'expiring' ? 'text-amber-600' : l.status === 'expired' || l.status === 'revoked' ? 'text-muted-foreground' : ''}`}>
          {expiryText}
        </span>
      </TableCell>
      <TableCell className="py-3 px-2">
        <Badge className={`text-[10px] gap-1 ${STATUS_COLORS[l.status] ?? ''}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS[l.status] ?? ''}`} />
          {l.status.charAt(0).toUpperCase() + l.status.slice(1)}
        </Badge>
      </TableCell>
      <TableCell className="py-3 pl-2 pr-0">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100">
          {isLive && (
            <>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={copyUrl}>
                {copied ? <Check className="size-3 text-green-600" /> : <Copy className="size-3" />}
              </Button>
              <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-destructive border-destructive/30" onClick={onRevoke}>
                <X className="size-3" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

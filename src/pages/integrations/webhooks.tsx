import { useState, useEffect, useCallback } from 'react';
import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { api, apiErrorMessage } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { getIntegration } from '@/lib/integrations';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Plus, Trash2, Loader2, Send, RotateCw, Copy, Check, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, AlertTriangle, KeyRound,
} from 'lucide-react';
import { timeAgo } from '@/lib/helpers';
import { toast } from '@/lib/toast';

const meta = getIntegration('webhooks')!;

const EVENT_TYPES = [
  { value: 'file.uploaded', label: 'File uploaded' },
  { value: 'file.deleted', label: 'File deleted' },
  { value: 'share.accessed', label: 'Share accessed' },
] as const;

// ── Types ─────────────────────────────────────────────────

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  active: number;
  consecutive_failures: number;
  disabled_at: number | null;
  created_at: number;
}

interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  next_attempt_at: number | null;
  last_attempt_at: number | null;
  response_status: number | null;
  response_snippet: string | null;
  error: string | null;
  created_at: number;
}

interface Pagination { page: number; per_page: number; total: number; total_pages: number }

// Unlike created_at/last_attempt_at (past timestamps), next_attempt_at points
// into the future — timeAgo() would misreport it, so format it separately.
function retryEta(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'due now';
  if (diff < 60) return `in ${diff}s`;
  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `in ${Math.floor(diff / 3600)}h`;
  return `in ${Math.floor(diff / 86400)}d`;
}

// ── Page ──────────────────────────────────────────────────

export default function WebhooksPage() {
  const workspaceId = useWorkspace((s) => s.activeId);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<{ secret: string; url: string } | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await api<{ ok: boolean; webhooks: WebhookEndpoint[] }>(
        `/api/webhooks?workspace_id=${workspaceId}`,
      );
      if (data.ok) setWebhooks(data.webhooks);
    } catch (err) {
      toast.error('Failed to load webhooks', apiErrorMessage(err));
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <p className="mb-4 text-xs text-muted-foreground">
        Each event is delivered as a signed POST request. See the{' '}
        <a
          href={meta.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          API reference
        </a>{' '}
        for payload shapes and how to verify the <code className="text-[11px] text-foreground">X-Dosya-Signature</code> header.
      </p>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {loading ? 'Loading...' : `${webhooks.length} endpoint${webhooks.length === 1 ? '' : 's'}`}
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
          <Plus className="size-4" /> New endpoint
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i} className="gap-0 p-4">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="mt-2 h-3 w-40" />
              <Skeleton className="mt-3 h-7 w-full" />
            </Card>
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <Card className="gap-0 py-12 text-center text-sm text-muted-foreground">
          No webhook endpoints yet. Click &ldquo;New endpoint&rdquo; to register one.
        </Card>
      ) : (
        <div className="space-y-3">
          {webhooks.map((w) => (
            <EndpointCard key={w.id} endpoint={w} onChange={load} />
          ))}
        </div>
      )}

      {createOpen && workspaceId && (
        <EndpointFormDialog
          mode="create"
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={(wh) => {
            setCreateOpen(false);
            load();
            setNewSecret({ secret: wh.secret, url: wh.url });
          }}
        />
      )}

      {newSecret && (
        <SecretRevealDialog secret={newSecret.secret} url={newSecret.url} onClose={() => setNewSecret(null)} />
      )}
    </IntegrationLayout>
  );
}

// ── Endpoint card ─────────────────────────────────────────

function EndpointCard({ endpoint, onChange }: { endpoint: WebhookEndpoint; onChange: () => void }) {
  const [testing, setTesting] = useState(false);
  const [reenabling, setReenabling] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rollOpen, setRollOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [rolledSecret, setRolledSecret] = useState<string | null>(null);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [deliveriesReloadKey, setDeliveriesReloadKey] = useState(0);

  const active = endpoint.active !== 0;
  const disabled = !!endpoint.disabled_at;

  const sendTest = async () => {
    setTesting(true);
    try {
      await api(`/api/webhooks/${endpoint.id}/test`, { method: 'POST' });
      toast.success('Test event sent', 'Check the deliveries log below for the result.');
      setDeliveriesOpen(true);
      setDeliveriesReloadKey((k) => k + 1);
    } catch (err) {
      toast.error('Test failed', apiErrorMessage(err));
    }
    setTesting(false);
  };

  const reenable = async () => {
    setReenabling(true);
    try {
      await api(`/api/webhooks/${endpoint.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      toast.success('Webhook re-enabled');
      onChange();
    } catch (err) {
      toast.error('Re-enable failed', apiErrorMessage(err));
    }
    setReenabling(false);
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/webhooks/${endpoint.id}`, { method: 'DELETE' });
      toast.success('Webhook deleted');
      setDeleteOpen(false);
      onChange();
    } catch (err) {
      toast.error('Delete failed', apiErrorMessage(err));
    }
    setDeleting(false);
  };

  const rollSecret = async () => {
    setRolling(true);
    try {
      const res = await api<{ ok: boolean; secret: string }>(`/api/webhooks/${endpoint.id}/roll-secret`, { method: 'POST' });
      setRollOpen(false);
      setRolledSecret(res.secret);
    } catch (err) {
      toast.error('Roll secret failed', apiErrorMessage(err));
    }
    setRolling(false);
  };

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium font-mono break-all">{endpoint.url}</p>
          {active ? (
            <Badge className="shrink-0 bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">Active</Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0 text-[10px]">Disabled</Badge>
          )}
        </div>
        {endpoint.description && <p className="mt-1 text-xs text-muted-foreground">{endpoint.description}</p>}
        <div className="mt-2 flex flex-wrap gap-1">
          {endpoint.events.map((e) => (
            <Badge key={e} variant="outline" className="text-[10px] font-mono">{e}</Badge>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Created {timeAgo(endpoint.created_at)}</p>

        {disabled && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="flex-1 text-xs">
              <p className="font-medium text-amber-800 dark:text-amber-400">Auto-disabled after repeated failures</p>
              <p className="mt-0.5 text-amber-700/80 dark:text-amber-500/80">
                {endpoint.consecutive_failures} consecutive failed deliveries &middot; disabled {timeAgo(endpoint.disabled_at!)}.
                Fix the endpoint, then re-enable it.
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={reenable} disabled={reenabling}>
              {reenabling ? <Loader2 className="size-3 animate-spin" /> : 'Re-enable'}
            </Button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={sendTest} disabled={testing}>
            {testing ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} Send test event
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setDeliveriesOpen((v) => !v)}>
            {deliveriesOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />} Deliveries
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>Edit</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setRollOpen(true)}>
            <KeyRound className="size-3" /> Roll secret
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3" /> Delete
          </Button>
        </div>
      </div>

      {deliveriesOpen && <DeliveriesSection key={deliveriesReloadKey} endpointId={endpoint.id} />}

      {editOpen && (
        <EndpointFormDialog
          mode="edit"
          initial={endpoint}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); onChange(); }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete webhook"
        description={(
          <>Delete the endpoint for <span className="font-mono text-foreground break-all">{endpoint.url}</span>?
            {' '}This can&rsquo;t be undone and its delivery history will be lost.
          </>
        )}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={remove}
        onClose={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={rollOpen}
        title="Roll signing secret"
        description="Generate a new signing secret for this endpoint. The old secret stops working immediately — update your receiver before rolling."
        confirmLabel="Roll secret"
        busy={rolling}
        onConfirm={rollSecret}
        onClose={() => setRollOpen(false)}
      />

      {rolledSecret && (
        <SecretRevealDialog secret={rolledSecret} url={endpoint.url} onClose={() => setRolledSecret(null)} />
      )}
    </Card>
  );
}

// ── Deliveries section ────────────────────────────────────

function DeliveriesSection({ endpointId }: { endpointId: string }) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [redeliveringId, setRedeliveringId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ ok: boolean; deliveries: Delivery[]; pagination: Pagination }>(
        `/api/webhooks/${endpointId}/deliveries?page=${page}&per_page=10`,
      );
      if (data.ok) { setDeliveries(data.deliveries); setPagination(data.pagination); }
    } catch (err) {
      toast.error('Failed to load deliveries', apiErrorMessage(err));
    }
    setLoading(false);
  }, [endpointId, page]);

  useEffect(() => { load(); }, [load]);

  const redeliver = async (id: string) => {
    setRedeliveringId(id);
    try {
      await api(`/api/webhooks/${endpointId}/deliveries/${id}/redeliver`, { method: 'POST' });
      toast.success('Redelivery queued', 'A new delivery attempt has been scheduled.');
      if (page === 1) load(); else setPage(1);
    } catch (err) {
      toast.error('Redeliver failed', apiErrorMessage(err));
    }
    setRedeliveringId(null);
  };

  return (
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Recent deliveries</p>
        <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading} title="Refresh">
          <RotateCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : deliveries.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No deliveries yet. Send a test event to see one here.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Event</TableHead>
              <TableHead className="text-[11px]">Created</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]">Response</TableHead>
              <TableHead className="text-[11px]">Attempts</TableHead>
              <TableHead className="text-[11px]">Next retry</TableHead>
              <TableHead className="text-[11px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="text-xs font-medium font-mono">{d.event_type}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{timeAgo(d.created_at)}</TableCell>
                <TableCell><DeliveryStatusBadge status={d.status} /></TableCell>
                <TableCell
                  className="text-xs text-muted-foreground"
                  title={d.error ?? d.response_snippet ?? undefined}
                >
                  {d.response_status != null ? d.response_status : d.error ? 'Error' : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.attempts}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.status === 'pending' && d.next_attempt_at ? retryEta(d.next_attempt_at) : '—'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => redeliver(d.id)} disabled={redeliveringId === d.id}
                  >
                    {redeliveringId === d.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
                    Redeliver
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pagination && pagination.total_pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-[11px] text-muted-foreground">Page {page} of {pagination.total_pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pagination.total_pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

function DeliveryStatusBadge({ status }: { status: Delivery['status'] }) {
  if (status === 'success') {
    return <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">Success</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="text-[10px]">Failed</Badge>;
  }
  return <Badge variant="secondary" className="text-[10px]">Pending</Badge>;
}

// ── Create / edit dialog ──────────────────────────────────

type EndpointFormProps =
  | { mode: 'create'; workspaceId: string; onClose: () => void; onCreated: (webhook: { id: string; url: string; secret: string }) => void }
  | { mode: 'edit'; initial: WebhookEndpoint; onClose: () => void; onSaved: () => void };

function EndpointFormDialog(props: EndpointFormProps) {
  const isEdit = props.mode === 'edit';
  const [url, setUrl] = useState(isEdit ? props.initial.url : '');
  const [events, setEvents] = useState<Set<string>>(new Set(isEdit ? props.initial.events : []));
  const [description, setDescription] = useState(isEdit ? (props.initial.description ?? '') : '');
  const [active, setActive] = useState(isEdit ? props.initial.active !== 0 : true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const toggleEvent = (value: string) => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const submit = async () => {
    setError('');
    const trimmedUrl = url.trim();
    if (!/^https:\/\/.+/.test(trimmedUrl)) { setError('URL must be a valid https:// address.'); return; }
    if (events.size === 0) { setError('Select at least one event type.'); return; }

    setSubmitting(true);
    try {
      if (props.mode === 'edit') {
        await api(`/api/webhooks/${props.initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            url: trimmedUrl, events: Array.from(events), description: description.trim() || null, active,
          }),
        });
        toast.success('Webhook updated');
        props.onSaved();
      } else {
        const res = await api<{ ok: boolean; webhook: { id: string; url: string; secret: string } }>('/api/webhooks', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: props.workspaceId,
            url: trimmedUrl,
            events: Array.from(events),
            description: description.trim() || undefined,
          }),
        });
        props.onCreated(res.webhook);
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    }
    setSubmitting(false);
  };

  return (
    <Dialog open onOpenChange={() => props.onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit webhook' : 'New webhook endpoint'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 -mx-4 px-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">Endpoint URL</Label>
            <Input
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/dosya"
              className="h-8 text-xs font-mono"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Events</Label>
            <div className="space-y-2">
              {EVENT_TYPES.map((et) => (
                <label key={et.value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={events.has(et.value)} onCheckedChange={() => toggleEvent(et.value)} />
                  <span>{et.label}</span>
                  <code className="text-[10px] text-muted-foreground">{et.value}</code>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">
              Description <span className="font-normal">(optional)</span>
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this endpoint for?"
              className="h-14 min-h-0 px-3 text-xs md:text-xs resize-y"
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={active} onCheckedChange={(checked) => setActive(!!checked)} />
              <span>Active</span>
            </label>
          )}

          {error && <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
            {submitting ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save changes' : 'Create endpoint')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Secret reveal dialog ──────────────────────────────────

function SecretRevealDialog({ secret, url, onClose }: { secret: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success('Secret copied', "Store it securely — you won't see it again.");
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Signing secret</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          Copy this now for <span className="font-mono text-foreground break-all">{url}</span> — we won&rsquo;t show it again.
        </p>
        <div className="flex gap-2">
          <Input value={secret} readOnly className="h-8 text-xs font-mono flex-1" />
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0 gap-1" onClick={copy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Use it to verify the <code className="text-[11px] text-foreground">X-Dosya-Signature</code> header on incoming requests.
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Done — I&rsquo;ve copied it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm dialog ────────────────────────────────────────

function ConfirmDialog({
  open, title, description, confirmLabel = 'Confirm', destructive, busy, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

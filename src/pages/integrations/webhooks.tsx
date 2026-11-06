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
import { t, useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';

const meta = getIntegration('webhooks')!;

const EVENT_TYPES = [
  { value: 'file.uploaded', labelKey: 'common.label.fileUploaded' },
  { value: 'file.deleted', labelKey: 'common.label.fileDeleted' },
  { value: 'share.accessed', labelKey: 'integrations-webhooks.label.shareAccessed' },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

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
// into the future - timeAgo() would misreport it, so format it separately.
function retryEta(ts: number): string {
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff <= 0) return t('integrations-webhooks.label.dueNow');
  if (diff < 60) return t('integrations-webhooks.label.inDiffS', { diff });
  if (diff < 3600) return t('integrations-webhooks.label.inMathfloorM', { MathFloor: Math.floor(diff / 60) });
  if (diff < 86400) return t('integrations-webhooks.label.inMathfloorH', { MathFloor: Math.floor(diff / 3600) });
  return t('integrations-webhooks.label.inMathfloorD', { MathFloor: Math.floor(diff / 86400) });
}

// ── Page ──────────────────────────────────────────────────

export default function WebhooksPage() {
  const t = useT();
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
      toast.error(t('integrations-webhooks.error.failedToLoadWebhooks'), apiErrorMessage(err));
    }
    setLoading(false);
  }, [workspaceId, t]);

  useEffect(() => { load(); }, [load]);

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <p className="mb-4 text-xs text-muted-foreground">
        {richText(t('integrations-webhooks.description.eachEventIsDeliveredAsASignedPostRequestSeeThe'), {
          link1: (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t('integrations-webhooks.action.apiReference')}
            </a>
          ),
          emphasis1: <code className="text-[11px] text-foreground">X-Dosya-Signature</code>,
        })}
      </p>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {loading ? t('common.label.loading') : t('integrations-webhooks.description.webhookscountPluralOneEndpointOtherEndpoints', { webhooksCount: webhooks.length })}
        </p>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
          <Plus className="size-4" /> {t('integrations-webhooks.action.newEndpoint')}
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
          {t('integrations-webhooks.description.noWebhookEndpointsYetClickLdquoNewEndpointRdquoToRegisterOne')}
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
  const t = useT();
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
      toast.success(t('integrations-webhooks.feedback.testEventSent'), t('integrations-webhooks.feedback.checkTheDeliveriesLogBelowForTheResult'));
      setDeliveriesOpen(true);
      setDeliveriesReloadKey((k) => k + 1);
    } catch (err) {
      toast.error(t('integrations-webhooks.error.testFailed'), apiErrorMessage(err));
    }
    setTesting(false);
  };

  const reenable = async () => {
    setReenabling(true);
    try {
      await api(`/api/webhooks/${endpoint.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
      toast.success(t('integrations-webhooks.feedback.webhookReEnabled'));
      onChange();
    } catch (err) {
      toast.error(t('integrations-webhooks.error.reEnableFailed'), apiErrorMessage(err));
    }
    setReenabling(false);
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/webhooks/${endpoint.id}`, { method: 'DELETE' });
      toast.success(t('integrations-webhooks.feedback.webhookDeleted'));
      setDeleteOpen(false);
      onChange();
    } catch (err) {
      toast.error(t('common.error.deleteFailed'), apiErrorMessage(err));
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
      toast.error(t('integrations-webhooks.error.rollSecretFailed'), apiErrorMessage(err));
    }
    setRolling(false);
  };

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      <div className="p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <p dir="ltr" className="text-sm font-medium font-mono break-all">{endpoint.url}</p>
          {active ? (
            <Badge className="shrink-0 bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">{t('integrations-webhooks.status.active.webhook')}</Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0 text-[10px]">{t('integrations-webhooks.status.disabled')}</Badge>
          )}
        </div>
        {endpoint.description && <p className="mt-1 text-xs text-muted-foreground">{endpoint.description}</p>}
        <div className="mt-2 flex flex-wrap gap-1">
          {endpoint.events.map((e) => (
            <Badge key={e} variant="outline" className="text-[10px] font-mono">{e}</Badge>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t('common.label.createdDate', { date: timeAgo(endpoint.created_at) })}</p>

        {disabled && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="flex-1 text-xs">
              <p className="font-medium text-amber-800 dark:text-amber-400">{t('integrations-webhooks.error.autoDisabledAfterRepeatedFailures')}</p>
              <p className="mt-0.5 text-amber-700/80 dark:text-amber-500/80">
                {t('integrations-webhooks.error.endpointconsecutiveFailuresConsecutiveFailedDeliveriesMiddotDisabledFormattedvalueFixTheEndpointThen', {
                  endpointConsecutive_failures: endpoint.consecutive_failures,
                  formattedValue: timeAgo(endpoint.disabled_at!),
                })}
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 shrink-0 text-xs" onClick={reenable} disabled={reenabling}>
              {reenabling ? <Loader2 className="size-3 animate-spin" /> : t('integrations-webhooks.action.reEnable')}
            </Button>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={sendTest} disabled={testing}>
            {testing ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3 rtl:-scale-x-100" />} {t('integrations-webhooks.action.sendTestEvent')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setDeliveriesOpen((v) => !v)}>
            {deliveriesOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />} {t('integrations-webhooks.action.deliveries')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditOpen(true)}>{t('common.edit')}</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setRollOpen(true)}>
            <KeyRound className="size-3" /> {t('integrations-webhooks.action.rollSecret')}
          </Button>
          <Button
            variant="outline" size="sm"
            className="h-7 text-xs gap-1 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="size-3" /> {t('common.delete')}
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
        title={t('integrations-webhooks.tooltip.deleteWebhook')}
        description={richText(t('integrations-webhooks.description.deleteTheEndpointForEndpointurlThisCanRsquoTBeUndoneAndIts'), {
          endpointUrl: <span dir="ltr" className="font-mono text-foreground break-all">{endpoint.url}</span>,
        })}
        confirmLabel={t('common.delete')}
        destructive
        busy={deleting}
        onConfirm={remove}
        onClose={() => setDeleteOpen(false)}
      />

      <ConfirmDialog
        open={rollOpen}
        title={t('integrations-webhooks.tooltip.rollSigningSecret')}
        description={t('integrations-webhooks.description.generateANewSigningSecretForThisEndpointTheOldSecret')}
        confirmLabel={t('integrations-webhooks.action.rollSecret')}
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
  const t = useT();
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
      toast.error(t('integrations-webhooks.error.failedToLoadDeliveries'), apiErrorMessage(err));
    }
    setLoading(false);
  }, [endpointId, page, t]);

  useEffect(() => { load(); }, [load]);

  const redeliver = async (id: string) => {
    setRedeliveringId(id);
    try {
      await api(`/api/webhooks/${endpointId}/deliveries/${id}/redeliver`, { method: 'POST' });
      toast.success(t('integrations-webhooks.feedback.redeliveryQueued'), t('integrations-webhooks.feedback.aNewDeliveryAttemptHasBeenScheduled'));
      if (page === 1) load(); else setPage(1);
    } catch (err) {
      toast.error(t('integrations-webhooks.error.redeliverFailed'), apiErrorMessage(err));
    }
    setRedeliveringId(null);
  };

  return (
    <div className="border-t bg-muted/20 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{t('integrations-webhooks.label.recentDeliveries')}</p>
        <Button variant="ghost" size="icon-sm" onClick={load} disabled={loading} title={t('common.action.refresh')}>
          <RotateCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : deliveries.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t('integrations-webhooks.description.noDeliveriesYetSendATestEventToSeeOneHere')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">{t('common.label.event')}</TableHead>
              <TableHead className="text-[11px]">{t('common.label.created')}</TableHead>
              <TableHead className="text-[11px]">{t('common.column.status')}</TableHead>
              <TableHead className="text-[11px]">{t('integrations-webhooks.label.response')}</TableHead>
              <TableHead className="text-[11px]">{t('integrations-webhooks.label.attempts')}</TableHead>
              <TableHead className="text-[11px]">{t('integrations-webhooks.label.nextRetry')}</TableHead>
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
                  {d.response_status != null ? d.response_status : d.error ? t('common.status.error') : '-'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{d.attempts}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.status === 'pending' && d.next_attempt_at ? retryEta(d.next_attempt_at) : '-'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => redeliver(d.id)} disabled={redeliveringId === d.id}
                  >
                    {redeliveringId === d.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
                    {t('integrations-webhooks.action.redeliver')}
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
            <ChevronLeft className="size-3.5 rtl:-scale-x-100" />
          </Button>
          <span className="text-[11px] text-muted-foreground">{t('common.label.pagePageOfPaginationtotalPages', { page, pageCount: pagination.total_pages })}</span>
          <Button variant="outline" size="sm" disabled={page >= pagination.total_pages} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="size-3.5 rtl:-scale-x-100" />
          </Button>
        </div>
      )}
    </div>
  );
}

function DeliveryStatusBadge({ status }: { status: Delivery['status'] }) {
  const t = useT();
  if (status === 'success') {
    return <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">{t('integrations-webhooks.status.success')}</Badge>;
  }
  if (status === 'failed') {
    return <Badge variant="destructive" className="text-[10px]">{t('common.status.failed')}</Badge>;
  }
  return <Badge variant="secondary" className="text-[10px]">{t('common.status.pending')}</Badge>;
}

// ── Create / edit dialog ──────────────────────────────────

type EndpointFormProps =
  | { mode: 'create'; workspaceId: string; onClose: () => void; onCreated: (webhook: { id: string; url: string; secret: string }) => void }
  | { mode: 'edit'; initial: WebhookEndpoint; onClose: () => void; onSaved: () => void };

function EndpointFormDialog(props: EndpointFormProps) {
  const t = useT();
  const isEdit = props.mode === 'edit';
  const [url, setUrl] = useState(isEdit ? props.initial.url : '');
  const [events, setEvents] = useState<Set<string>>(new Set(isEdit ? props.initial.events : []));
  const [description, setDescription] = useState(isEdit ? (props.initial.description ?? '') : '');
  const [active, setActive] = useState(isEdit ? props.initial.active !== 0 : true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // The label keeps "(optional)" in its lighter weight: split the message at the parenthesis.
  const descriptionLabel = t('integrations-webhooks.label.descriptionOptional');
  const optional = descriptionLabel.match(/^(.*?)\s*([(\uff08].*[)\uff09])\s*$/);

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
    if (!/^https:\/\/.+/.test(trimmedUrl)) { setError(t('integrations-webhooks.error.urlMustBeAValidHttpsAddress')); return; }
    if (events.size === 0) { setError(t('integrations-webhooks.error.selectAtLeastOneEventType')); return; }

    setSubmitting(true);
    try {
      if (props.mode === 'edit') {
        await api(`/api/webhooks/${props.initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            url: trimmedUrl, events: Array.from(events), description: description.trim() || null, active,
          }),
        });
        toast.success(t('integrations-webhooks.feedback.webhookUpdated'));
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
          <DialogTitle>{isEdit ? t('integrations-webhooks.heading.editWebhook') : t('integrations-webhooks.heading.newWebhookEndpoint')}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 -mx-4 px-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">{t('integrations-webhooks.label.endpointUrl')}</Label>
            <Input
              value={url}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/dosya"
              className="h-8 text-xs font-mono"
              autoFocus
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('common.label.events')}</Label>
            <div className="space-y-2">
              {EVENT_TYPES.map((et) => (
                <label key={et.value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={events.has(et.value)} onCheckedChange={() => toggleEvent(et.value)} />
                  <span>{t(et.labelKey)}</span>
                  <code className="text-[10px] text-muted-foreground">{et.value}</code>
                </label>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1 block">
              {optional ? <>{optional[1]} <span className="font-normal">{optional[2]}</span></> : descriptionLabel}
            </Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('integrations-webhooks.placeholder.whatIsThisEndpointFor')}
              className="h-14 min-h-0 px-3 text-xs md:text-xs resize-y"
            />
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={active} onCheckedChange={(checked) => setActive(!!checked)} />
              <span>{t('integrations-webhooks.status.active.webhook')}</span>
            </label>
          )}

          {error && <p dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin me-1.5" /> : null}
            {submitting ? (isEdit ? t('common.action.saving') : t('common.action.creating')) : (isEdit ? t('common.action.saveChanges') : t('integrations-webhooks.action.createEndpoint'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Secret reveal dialog ──────────────────────────────────

function SecretRevealDialog({ secret, url, onClose }: { secret: string; url: string; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success(t('integrations-webhooks.feedback.secretCopied'), t('integrations-webhooks.feedback.storeItSecurelyYouWonTSeeItAgain'));
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('integrations-webhooks.heading.signingSecret')}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          {richText(t('integrations-webhooks.description.copyThisNowForUrlWeWonRsquoTShowItAgain'), {
            url: <span dir="ltr" className="font-mono text-foreground break-all">{url}</span>,
          })}
        </p>
        <div className="flex gap-2">
          <Input value={secret} readOnly dir="ltr" className="h-8 text-xs font-mono flex-1" />
          <Button variant="outline" size="sm" className="h-8 text-xs shrink-0 gap-1" onClick={copy}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? t('common.action.copied') : t('common.copy')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {richText(t('integrations-webhooks.description.useItToVerifyTheEmphasis1HeaderOnIncomingRequests'), {
            emphasis1: <code className="text-[11px] text-foreground">X-Dosya-Signature</code>,
          })}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{t('integrations-webhooks.action.doneIRsquoVeCopiedIt')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Confirm dialog ────────────────────────────────────────

function ConfirmDialog({
  open, title, description, confirmLabel, destructive, busy, onConfirm, onClose,
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
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">{description}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : (confirmLabel ?? t('common.label.confirm'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

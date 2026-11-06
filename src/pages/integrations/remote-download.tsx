import { useState, useEffect, useCallback } from 'react';
import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { api, apiErrorMessage } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { getIntegration } from '@/lib/integrations';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { Folder, Loader2, X, CloudDownload } from 'lucide-react';
import { timeAgo, humanSize } from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { t, useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import { useRemoteDownloads } from '@/stores/remote-downloads';

const meta = getIntegration('remote-download')!;
const POLL_MS = 3_000;
const ACTIVE = new Set(['queued', 'downloading', 'finalizing']);

interface Job {
  id: string;
  url: string;
  filename: string;
  status: 'queued' | 'downloading' | 'finalizing' | 'done' | 'error' | 'cancelled';
  bytes_total: number | null;
  bytes_done: number;
  error_code: string | null;
  file_id: string | null;
  created_at: number;
}

const ERROR_MESSAGES: Record<string, MessageKey> = {
  ssrf_blocked: 'integrations-remote-download.error.addressNotAllowed',
  not_a_file: 'integrations-remote-download.label.notADirectFileLink',
  unknown_size: 'integrations-remote-download.label.unknownFileSize',
  too_large: 'common.error.fileTooLarge',
  quota: 'integrations-remote-download.label.notEnoughStorage',
  source_changed: 'integrations-remote-download.label.fileChangedOnTheSourceServer',
  network: 'integrations-remote-download.error.connectionToTheSourceFailed',
  backup_locked: 'integrations-remote-download.label.destinationIsALockedBackup',
};

function errorLabel(code: string | null): string {
  if (!code) return t('common.label.failed');
  if (code.startsWith('http_')) return t('integrations-remote-download.label.sourceReturnedHttpCodeslice', { codeSlice: code.slice(5) });
  return t(ERROR_MESSAGES[code] ?? 'common.label.failed');
}

function StatusBadge({ job }: { job: Job }) {
  const t = useT();
  if (job.status === 'done') return <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">{t('integrations-remote-download.status.done')}</Badge>;
  if (job.status === 'error') return <Badge variant="destructive" className="text-[10px]" title={errorLabel(job.error_code)}>{t('common.status.failed')}</Badge>;
  if (job.status === 'cancelled') return <Badge variant="secondary" className="text-[10px]">{t('integrations-remote-download.status.cancelled')}</Badge>;
  return <Badge variant="secondary" className="text-[10px] capitalize">{job.status}</Badge>;
}

export default function RemoteDownloadPage() {
  const t = useT();
  const workspaceId = useWorkspace((s) => s.activeId);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const data = await api<{ ok: boolean; jobs: Job[] }>(`/api/remote-downloads?workspace_id=${workspaceId}`);
      setJobs(data.jobs);
    } catch {
      setJobs((prev) => prev ?? []);
    }
  }, [workspaceId]);

  useEffect(() => { load(); }, [load]);

  const hasActive = (jobs ?? []).some((j) => ACTIVE.has(j.status));
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [hasActive, load]);

  async function submit() {
    if (!workspaceId || !url.trim() || submitting) return;
    setSubmitting(true);
    try {
      const data = await api<{ ok: boolean; job: Job }>('/api/remote-downloads', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), workspace_id: workspaceId, folder_id: folder.id }),
      });
      setJobs((prev) => [data.job, ...(prev ?? [])]);
      setUrl('');
      useRemoteDownloads.getState().refresh();
      toast.success(t('common.feedback.downloadStarted'), t('integrations-remote-download.feedback.dosyaIsFetchingTheFileForYouYouCanClose'));
    } catch (err) {
      toast.error(t('integrations-remote-download.error.couldNotStartDownload'), apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function removeJob(job: Job) {
    if (!workspaceId) return;
    try {
      await api(`/api/remote-downloads/${job.id}?workspace_id=${workspaceId}`, { method: 'DELETE' });
      await load();
      useRemoteDownloads.getState().refresh();
    } catch (err) {
      toast.error(t('integrations-remote-download.error.couldNotRemoveDownload'), apiErrorMessage(err));
    }
  }

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {/* TODO(catalog): the source has a plain space in "Google Drive"; the shipped copy had a non-breaking one. */}
          {t('integrations-remote-download.description.pasteADirectHttpsLinkToAFileDosyaDownloadsIt').replace('Google Drive', 'Google\u00a0Drive')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="https://example.com/big-file.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <Button variant="outline" onClick={() => setPickerOpen(true)}>
            <Folder className="size-4" /> {folder.id ? folder.name : t('common.label.home')}
          </Button>
          <Button onClick={submit} disabled={!url.trim() || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
            {t('integrations-remote-download.action.fetchFile')}
          </Button>
        </div>
      </Card>

      {jobs === null ? (
        <Skeleton className="h-24 w-full" />
      ) : jobs.length === 0 ? (
        <Card className="gap-0 py-12 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
            <CloudDownload className="size-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium">{t('integrations-remote-download.label.noRemoteDownloadsYet')}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {t('integrations-remote-download.description.pasteADirectFileLinkAboveAndDosyaWillDownloadIt')}
          </p>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('common.label.fileTitleCase')}</TableHead>
              <TableHead>{t('common.column.status')}</TableHead>
              <TableHead>{t('integrations-remote-download.label.progress')}</TableHead>
              <TableHead>{t('integrations-remote-download.label.started')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const pct = job.bytes_total ? Math.floor((job.bytes_done / job.bytes_total) * 100) : 0;
              return (
                <TableRow key={job.id}>
                  <TableCell className="max-w-[220px] truncate" title={job.url}>{job.filename}</TableCell>
                  <TableCell><StatusBadge job={job} /></TableCell>
                  <TableCell className="min-w-[140px]">
                    {ACTIVE.has(job.status) ? (
                      <div className="space-y-1">
                        <div className="h-1.5 w-full rounded-full bg-muted">
                          <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {humanSize(job.bytes_done)} / {job.bytes_total ? humanSize(job.bytes_total) : '-'}
                        </span>
                      </div>
                    ) : job.status === 'done' ? (
                      <span className="text-xs text-muted-foreground">{job.bytes_total ? humanSize(job.bytes_total) : ''}</span>
                    ) : job.status === 'error' ? (
                      <span className="text-xs text-destructive">{errorLabel(job.error_code)}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{timeAgo(job.created_at)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon-xs" onClick={() => removeJob(job)}
                      title={ACTIVE.has(job.status) ? t('integrations-remote-download.action.cancelDownload') : t('common.action.removeFromList')}>
                      <X className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {pickerOpen && workspaceId && (
        <FolderPickerDialog
          open
          onClose={() => setPickerOpen(false)}
          workspaceId={workspaceId}
          selectedId={folder.id}
          onSelect={(id, name) => { setFolder({ id, name: id ? name : '' }); setPickerOpen(false); }}
          title={t('integrations-remote-download.tooltip.downloadIntoFolder')}
          confirmLabel={t('profile.label.select')}
        />
      )}
    </IntegrationLayout>
  );
}

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

const ERROR_MESSAGES: Record<string, string> = {
  ssrf_blocked: 'Address not allowed',
  not_a_file: 'Not a direct file link',
  unknown_size: 'Unknown file size',
  too_large: 'File too large',
  quota: 'Not enough storage',
  source_changed: 'File changed on the source server',
  network: 'Connection to the source failed',
};

function errorLabel(code: string | null): string {
  if (!code) return 'Failed';
  if (code.startsWith('http_')) return `Source returned HTTP ${code.slice(5)}`;
  return ERROR_MESSAGES[code] ?? 'Failed';
}

function StatusBadge({ job }: { job: Job }) {
  if (job.status === 'done') return <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400 text-[10px]">Done</Badge>;
  if (job.status === 'error') return <Badge variant="destructive" className="text-[10px]" title={errorLabel(job.error_code)}>Failed</Badge>;
  if (job.status === 'cancelled') return <Badge variant="secondary" className="text-[10px]">Cancelled</Badge>;
  return <Badge variant="secondary" className="text-[10px] capitalize">{job.status}</Badge>;
}

export default function RemoteDownloadPage() {
  const workspaceId = useWorkspace((s) => s.activeId);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState<{ id: string | null; name: string }>({ id: null, name: 'Home' });
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
      toast.success('Download started', 'dosya is fetching the file for you — you can close this page.');
    } catch (err) {
      toast.error('Could not start download', apiErrorMessage(err));
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
      toast.error('Could not remove download', apiErrorMessage(err));
    }
  }

  return (
    <IntegrationLayout icon={meta.icon} title={meta.title} description={meta.description}>
      <Card className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste a direct https link to a file. dosya downloads it on our servers straight into your
          workspace — nothing goes through your connection. Direct file links only (a Google&nbsp;Drive
          or Dropbox share page won't work).
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="https://example.com/big-file.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <Button variant="outline" onClick={() => setPickerOpen(true)}>
            <Folder className="size-4" /> {folder.name}
          </Button>
          <Button onClick={submit} disabled={!url.trim() || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />}
            Fetch file
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
          <p className="mt-3 text-sm font-medium">No remote downloads yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Paste a direct file link above and dosya will download it into your
            workspace for you — no matter how slow your own connection is.
          </p>
        </Card>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Started</TableHead>
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
                          {humanSize(job.bytes_done)} / {job.bytes_total ? humanSize(job.bytes_total) : '—'}
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
                      title={ACTIVE.has(job.status) ? 'Cancel download' : 'Remove from list'}>
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
          onSelect={(id, name) => { setFolder({ id, name: id ? name : 'Home' }); setPickerOpen(false); }}
          title="Download into folder"
          confirmLabel="Select"
        />
      )}
    </IntegrationLayout>
  );
}

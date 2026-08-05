import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CopyX, Folder, Loader2, Trash2 } from 'lucide-react';
import { api, apiErrorMessage } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { toast } from '@/lib/toast';
import { humanSize, timeAgo, fileIconSrc } from '@/lib/helpers';
import { formatBytes } from '@/lib/billing/cart-math';
import { FILES_QUERY_ROOT } from '@/lib/files-request';
import {
  allButNewest, chunk, duplicatesQueryKey, fetchDuplicates,
  fullySelectedGroups, selectedBytes, type DuplicatesResponse,
} from '@/lib/duplicates';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectCheckbox } from '@/components/select-checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';

/** Poll while the scanner is still draining this workspace's candidates. */
const SCAN_POLL_MS = 15_000;

export default function DuplicatesPage() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const query = useQuery({
    queryKey: duplicatesQueryKey(wsId),
    queryFn: () => fetchDuplicates(wsId),
    enabled: !!wsId,
    refetchInterval: (q) =>
      ((q.state.data as DuplicatesResponse | undefined)?.scanning.pending ?? 0) > 0
        ? SCAN_POLL_MS
        : false,
  });

  const data = query.data;
  const groups = data?.groups ?? [];
  const pending = data?.scanning.pending ?? 0;
  const fullGroups = fullySelectedGroups(groups, selected);
  const bytesSelected = selectedBytes(groups, selected);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runDelete = async () => {
    setConfirming(false);
    setDeleting(true);
    const count = selected.size;
    try {
      // batch-delete caps file_ids at 500 per request.
      for (const ids of chunk(Array.from(selected))) {
        await api('/api/files/batch-delete', {
          method: 'POST',
          body: JSON.stringify({ workspace_id: wsId, file_ids: ids }),
        });
      }
      toast.success('Moved to trash', `${count} file${count === 1 ? '' : 's'} moved to trash.`);
      setSelected(new Set());
    } catch (err) {
      toast.error('Delete failed', apiErrorMessage(err, 'The selected files could not be moved to trash.'));
    }
    // Refresh both this page and the files listing (soft-deletes change both);
    // on partial failure the refetch shows what actually happened.
    queryClient.invalidateQueries({ queryKey: duplicatesQueryKey(wsId) });
    queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT, wsId] });
    setDeleting(false);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      {/* Header: totals + scanning chip + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-muted-foreground">
          {data && data.total_groups > 0 && (
            <span>
              {data.total_groups} duplicate group{data.total_groups === 1 ? '' : 's'}
              {' · '}{formatBytes(data.total_wasted_bytes)} reclaimable
            </span>
          )}
        </div>
        {pending > 0 && (
          <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            {pending} file{pending === 1 ? '' : 's'} still being scanned
          </div>
        )}
        <div className="flex-1" />
        {groups.length > 0 && (
          <Button
            variant="outline" size="sm" className="h-7 text-xs"
            onClick={() => setSelected(new Set(allButNewest(groups)))}
          >
            Select all but newest
          </Button>
        )}
        {selected.size > 0 && (
          <>
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-7 text-xs text-destructive border-destructive/30"
              disabled={deleting}
              onClick={() => setConfirming(true)}
            >
              {deleting
                ? <Loader2 className="size-3 mr-1 animate-spin" />
                : <Trash2 className="size-3 mr-1" />}
              Move {selected.size} to trash
            </Button>
          </>
        )}
      </div>

      {/* Body */}
      {query.isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {query.isError && (
        <EmptyState
          icon={CopyX}
          title="Duplicates could not be loaded"
          description={apiErrorMessage(query.error, 'Something went wrong. Please try again.')}
          actions={<Button size="sm" className="h-7 text-xs" onClick={() => query.refetch()}>Retry</Button>}
        />
      )}
      {data && groups.length === 0 && (
        pending > 0 ? (
          <EmptyState
            icon={CopyX}
            title="Scanning your files"
            description="We are comparing your files to find exact duplicates. Results appear here as the scan progresses - this page refreshes itself."
          />
        ) : (
          <EmptyState
            icon={CopyX}
            title="No duplicates found"
            description="Every file in this workspace is unique. New uploads are checked automatically."
          />
        )
      )}

      {groups.map((g) => (
        <Card key={g.content_hash} className="p-3 gap-0">
          <div className="flex items-center gap-2 mb-2">
            <img src={fileIconSrc(g.files[0].name)} alt="" className="w-6 h-6 shrink-0" />
            <span className="text-sm font-medium">{g.count} identical copies</span>
            <span className="text-xs text-muted-foreground">
              {humanSize(g.size_bytes)} each · {humanSize(g.wasted_bytes)} reclaimable
            </span>
            <div className="flex-1" />
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const f of g.files.slice(1)) next.add(f.id);
                  return next;
                })
              }
            >
              Select all but newest
            </button>
          </div>
          <div className="divide-y">
            {g.files.map((f, i) => (
              <div key={f.id} className="flex items-center gap-2.5 py-1.5 text-sm">
                <SelectCheckbox
                  checked={selected.has(f.id)}
                  onCheckedChange={() => toggle(f.id)}
                  className="size-4"
                />
                <span className="truncate flex-1 min-w-0">
                  {f.name}
                  {i === 0 && <span className="ml-2 text-xs text-muted-foreground">newest</span>}
                </span>
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  onClick={() => navigate(`/files${f.folder_id ? `?folder=${f.folder_id}` : ''}`)}
                  title="Open containing folder"
                >
                  <Folder className="size-3" />
                  <span className="truncate max-w-40">{f.folder_path ?? 'Files'}</span>
                </button>
                <span className="text-xs text-muted-foreground shrink-0 w-24 text-right" title={f.uploader_name ?? undefined}>
                  {timeAgo(f.created_at)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {data && data.total_groups > groups.length && (
        <p className="text-xs text-muted-foreground text-center">
          Showing the {groups.length} largest groups of {data.total_groups}. Clean these up and the rest move up.
        </p>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirming} onOpenChange={(open) => { if (!open && !deleting) setConfirming(false); }}>
        <DialogContent className="max-w-sm" showCloseButton={!deleting}>
          <DialogHeader>
            <DialogTitle>Move {selected.size} file{selected.size === 1 ? '' : 's'} to trash?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>This frees {formatBytes(bytesSelected)}. Files go to the trash and can be restored from there.</p>
            {fullGroups > 0 && (
              <p className="text-destructive">
                In {fullGroups} group{fullGroups === 1 ? '' : 's'} you selected EVERY copy - nothing of those files will remain outside the trash.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={runDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Move to trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

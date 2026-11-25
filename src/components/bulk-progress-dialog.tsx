import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { formatNumber } from '@/lib/format-locale';

export interface BulkDeleteProgress {
  done: number;
  total: number;
  permanent: boolean;
  /** Files moved so far out of selected folders. One big folder is a single
   *  item, so the item count alone would sit still for the whole delete. */
  filesMoved?: number;
}

/**
 * Blocking progress modal for bulk deletes. Deliberately non-dismissable: the
 * open state is driven purely by `progress` and close requests (Escape,
 * backdrop click) are ignored, so the modal can't be dropped while requests
 * are still in flight. Soft delete runs with no cancel; the permanent path
 * passes `onCancel`, which stops launching new requests - items already
 * deleted stay deleted.
 */
export function BulkProgressDialog({ progress, onCancel, cancelRequested }: {
  progress: BulkDeleteProgress | null;
  onCancel?: () => void;
  cancelRequested?: boolean;
}) {
  const t = useT();
  return (
    <Dialog open={!!progress} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{progress?.permanent ? t('files.heading.deletingPermanently') : t('files.status.deleting')}</DialogTitle>
          <DialogDescription>
            {progress && (
              <>
                <span className="tabular-nums">{t('common.label.sentOfTotal', { sent: progress.done, total: progress.total })}</span>
                {` ${t('files.description.itemProgresstotalPluralOneOtherSDeleted', { progressTotal: progress.total })}`}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <Progress value={progress?.done ?? 0} max={Math.max(progress?.total ?? 0, 1)} />
        {!!progress?.filesMoved && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {t('files.description.purgeprogresstolocalestringFilePurgeprogressPluralOneOtherSRemovedSoFar', { purgeProgressToLocaleString: formatNumber(progress.filesMoved), purgeProgress: progress.filesMoved })}
          </p>
        )}
        {progress?.permanent && onCancel && (
          <DialogFooter>
            <Button variant="outline" onClick={onCancel} disabled={cancelRequested}>
              {cancelRequested ? t('common.status.cancelling') : t('common.cancel')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

export interface BulkDeleteProgress {
  done: number;
  total: number;
  permanent: boolean;
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
  return (
    <Dialog open={!!progress} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{progress?.permanent ? 'Deleting permanently…' : 'Deleting…'}</DialogTitle>
          <DialogDescription>
            {progress && (
              <>
                <span className="tabular-nums">{progress.done} of {progress.total}</span>
                {` item${progress.total === 1 ? '' : 's'} deleted.`}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <Progress value={progress?.done ?? 0} max={Math.max(progress?.total ?? 0, 1)} />
        {progress?.permanent && onCancel && (
          <DialogFooter>
            <Button variant="outline" onClick={onCancel} disabled={cancelRequested}>
              {cancelRequested ? 'Cancelling…' : 'Cancel'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

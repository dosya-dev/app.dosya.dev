import { formatDateWith } from '@/lib/format-locale';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { cancelSubscription, type BillingStatus } from '@/api/billing';
import { apiErrorMessage } from '@/api/client';
import { activeTrialEnd, formatBytes } from '@/lib/billing/cart-math';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

/** Storage every account keeps on the Free plan. Mirrors the `free` row in D1. */
const FREE_BYTES = 5 * 1024 * 1024 * 1024;

export function CancelSubscriptionDialog({ data, onClose, onCancelled }: {
  data: BillingStatus;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endsOn = data.subscription.current_period_end
    ? formatDateWith(data.subscription.current_period_end, { month: 'long', day: 'numeric', year: 'numeric' }, 'en-US')
    : null;
  const trialEnd = activeTrialEnd(data.subscription);
  const trialEndsOn = trialEnd
    ? formatDateWith(trialEnd, { month: 'long', day: 'numeric', year: 'numeric' }, 'en-US')
    : null;
  const overFreeLimit = data.usage.used_bytes > FREE_BYTES;

  const confirm = () => {
    setBusy(true);
    setError(null);
    cancelSubscription()
      .then(() => { onCancelled(); onClose(); })
      .catch((e) => { setError(apiErrorMessage(e)); setBusy(false); });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{trialEndsOn ? t('billing.heading.cancelYourTrial') : t('billing.heading.cancelSubscription')}</DialogTitle>
        </DialogHeader>

        {trialEndsOn ? (
          <div className="space-y-3 text-sm">
            <p>{t('billing.description.youWonTBeChargedYourPlanStaysOnUntilTrialendsonAnd', { trialEndsOn })}</p>
            {overFreeLimit && (
              <p className="text-muted-foreground">
                {t('billing.description.youAreUsingUsageusedBytesYourFilesAreNeverDeletedButYou', { usageUsed_bytes: formatBytes(data.usage.used_bytes) })}
              </p>
            )}
            {error && <p dir="auto" className="text-red-600">{error}</p>}
          </div>
        ) : (
        <div className="space-y-3 text-sm">
          <p>
            {richText(
              t('billing.description.yourPlannamePlanAndEveryAddOnStayActiveHasendson', {
                planName: data.plan.name,
                FREE_BYTES: formatBytes(FREE_BYTES),
                hasEndsOn: endsOn ? 'true' : 'false',
                endsOn: '{endsOn}',
              }),
              { endsOn: <span className="font-medium">{endsOn}</span> },
            )}
          </p>
          <p className="text-muted-foreground">{t('billing.description.youKeepTheOldStorageLimitFor14MoreDaysAs')}</p>
          <p className="text-muted-foreground">
            {t('billing.description.youAreUsingUsageusedBytesOverfreelimitSelectTrueYourFilesAreNever', { usageUsed_bytes: formatBytes(data.usage.used_bytes), overFreeLimit: String(overFreeLimit) })}
          </p>
          <p className="text-muted-foreground">{t('billing.description.youCanResumeAnyTimeBeforeTheEndDate')}</p>
          {error && <p dir="auto" className="text-red-600">{error}</p>}
        </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{trialEndsOn ? t('billing.action.keepMyTrial') : t('billing.action.keepSubscription')}</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? t('common.status.cancelling') : trialEndsOn ? t('billing.action.cancelTrial') : t('billing.action.cancelSubscription')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

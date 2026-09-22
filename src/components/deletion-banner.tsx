import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useSession } from '@/stores/session';
import { formatScheduledDate, daysRemaining } from '@/lib/account-deletion';

/**
 * Persistent notice while an account deletion is pending.
 *
 * It lives in the layout rather than on the Profile page because someone who
 * scheduled a deletion and then forgot should be reminded wherever they are, not
 * only on the screen they scheduled it from. Two weeks of silence followed by an
 * empty account is the outcome this prevents.
 *
 * Reads the flag off the session store, which the boot gate fills from GET
 * /api/me - this used to be a third GET /api/me of its own on every load. The
 * profile page refreshes the store after a cancellation, so the banner
 * disappears without a reload.
 */
export function DeletionBanner() {
  const scheduledFor = useSession((s) => s.user?.deletion_scheduled_for ?? null);

  if (scheduledFor == null) return null;

  const days = daysRemaining(scheduledFor, Math.floor(Date.now() / 1000));

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-b bg-destructive/10 border-destructive/30"
      data-testid="deletion-banner"
    >
      <AlertTriangle className="size-3.5 text-destructive shrink-0" />
      <p className="text-xs text-destructive flex-1 min-w-0">
        Your account is scheduled for deletion on{' '}
        <span className="font-semibold">{formatScheduledDate(scheduledFor)}</span>
        {days > 0 ? ` - ${days} day${days === 1 ? '' : 's'} left.` : ' - today.'}
      </p>
      <Link
        to="/profile?section=delete"
        className="text-xs font-medium underline text-destructive shrink-0 hover:no-underline"
      >
        Cancel deletion
      </Link>
    </div>
  );
}

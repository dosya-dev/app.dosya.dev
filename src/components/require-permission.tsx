import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { usePermissions } from '@/hooks/use-permissions';

/**
 * A page gate for the `access_*` permissions.
 *
 * The sidebar has always hidden the links a role may not follow, but hiding a
 * link is not a gate: typing /settings still mounted the whole settings page,
 * which is how a member came to be looking at the workspace's IP allowlist and
 * 2FA policy (2026-09-25). The server side of that is fixed - GET
 * /api/workspaces/:id now projects the row down for anyone without
 * `access_settings` - and this is the other half: don't render a page whose
 * door is known to be locked.
 *
 * This is presentation, NOT enforcement. The API remains the authority, the
 * same way `usePermissions` describes. Nothing here decides what is allowed.
 *
 * FAILS OPEN, deliberately, and for the same reason the hook does: `can()`
 * answers true while the map is missing, so a network blip shows the page
 * rather than telling people their own workspace is off limits. Only a
 * RESOLVED map that says no closes the door.
 */
export function RequirePermission({ perm, children }: { perm: string; children: ReactNode }) {
  const { can, isResolved, isLoading } = usePermissions();

  // Held back rather than rendered-then-swapped: mounting the page for a beat
  // and yanking it away reads as a bug, and the page would fire its own
  // queries on the way past.
  if (isLoading) return <div className="p-6" aria-busy="true" />;

  if (isResolved && !can(perm)) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card className="gap-3 py-12 text-center text-sm text-muted-foreground">
          <Lock className="size-5 mx-auto opacity-60" />
          <p>You do not have access to this page.</p>
          <p className="text-xs">
            Ask a workspace owner or admin if you need it.{' '}
            <Link to="/" className="underline hover:text-foreground">Back to dashboard</Link>
          </p>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}

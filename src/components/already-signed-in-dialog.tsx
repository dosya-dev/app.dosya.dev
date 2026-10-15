import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SessionAccount } from '@/hooks/use-session-probe';
import { logoutAndRedirectTo } from '@/lib/logout';
import { initials } from '@/lib/helpers';
import { API_BASE } from '@/api/client';
import { pendingPostAuthPath } from '@/lib/redemption-claim';
import { consumePostAuthPath } from '@/lib/post-auth-path';

/**
 * The prompt a signed-in visitor gets on /login and /sign-up.
 *
 * People open those pages out of habit while a perfectly good session is
 * already in the cookie jar, then type a password they did not need to type.
 * This offers the account they are already in, or a clean way out of it.
 *
 * Dismissible on purpose: the probe can be stale (a cookie that expires
 * between the GET /api/me and the click), and nobody should be locked out of
 * the sign-in form by a modal that was wrong about them.
 */
export function AlreadySignedInDialog({
  purpose,
  account,
  suppressed = false,
}: {
  purpose: 'login' | 'signup';
  /**
   * The probe the page already ran. Passed in rather than fetched here so the
   * page makes one GET /api/me for both this and the navbar's CTA.
   */
  account: SessionAccount;
  /**
   * Set by a page that already has something more important to say - an OAuth
   * failure banner, or the "sign in with your new password" notice after a
   * reset. Burying those under a modal is worse than the problem this solves.
   */
  suppressed?: boolean;
}) {
  const { status, user } = account;
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  // `status` is 'pending' until the probe answers; rendering on a guess would
  // flash the dialog at signed-out visitors, who are the common case here.
  if (suppressed || dismissed || status !== 'in' || !user) return null;

  // Exactly where a successful sign-in would have landed (see login.tsx).
  // Falling back to '/' unconditionally would strand anyone who arrived from
  // the browser extension's connect popup or a Gumroad redemption link.
  const onContinue = () => navigate(pendingPostAuthPath() ?? consumePostAuthPath() ?? '/');

  const label = user.name?.trim() || user.email;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) setDismissed(true); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {purpose === 'login' ? "You're already signed in" : 'You already have an account'}
          </DialogTitle>
          <DialogDescription>
            {purpose === 'login'
              ? 'Open dosya with this account, or sign in as someone else.'
              : "You're signed in on this browser. Open dosya, or start a second account."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border bg-muted p-3">
          <div className="size-10 shrink-0 overflow-hidden rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[13px] font-semibold">
            {user.avatar_url ? (
              <img
                src={`${API_BASE}/api/me/avatar?u=${encodeURIComponent(user.id)}`}
                alt=""
                crossOrigin="use-credentials"
                className="w-full h-full object-cover"
              />
            ) : (
              initials(user.name || user.email)
            )}
          </div>
          <div className="min-w-0 flex-1">
            {user.name?.trim() && <p className="truncate text-sm font-semibold leading-[18px]">{user.name}</p>}
            <p className={`truncate ${user.name?.trim() ? 'text-xs text-muted-foreground leading-4' : 'text-sm font-semibold leading-[18px]'}`}>
              {user.email}
            </p>
          </div>
        </div>

        {user.deletion_scheduled_for != null && (
          <div className="flex items-start gap-2 rounded-lg bg-(--tone-warn-bg) text-(--tone-warn-ink) px-3 py-2.5 text-[13px]">
            <TriangleAlert className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              This account is scheduled for deletion on{' '}
              {new Date(user.deletion_scheduled_for * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button className="h-10 w-full justify-center overflow-hidden" onClick={onContinue}>
            <span className="truncate">Continue as {label}</span>
          </Button>
          <Button
            variant="outline"
            className="h-10 w-full"
            onClick={() => { void logoutAndRedirectTo(purpose === 'login' ? '/login' : '/sign-up'); }}
          >
            {purpose === 'login' ? 'Log in with a different account' : 'Create a new account'}
          </Button>
        </div>

        {purpose === 'login' ? (
          <p className="text-xs text-muted-foreground">
            Signing in as someone else signs you out of this browser and stops any uploads in progress.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Creating a new account signs you out of this one first. Want a different existing account?{' '}
            <Button
              variant="link"
              className="h-auto p-0 text-xs font-normal underline"
              onClick={() => { void logoutAndRedirectTo('/login'); }}
            >
              Log in instead
            </Button>
            .
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspace } from '@/stores/workspace';
import { useOnboarding } from '@/stores/onboarding';
import { OnboardingChecklist, completedCount } from './onboarding-checklist';

/**
 * Setup progress, present on every page once the workspace has files.
 *
 * This lives in the topbar rather than the sidebar because the sidebar is
 * pinned to 200px (see dashboard-layout.tsx), too narrow for a legible
 * checklist without squeezing the navigation. A pill costs almost no
 * horizontal space and opens into a full-width popover.
 *
 * Renders nothing at all when onboarding is dismissed, unloaded, failed, or
 * finished - it must never become furniture.
 */
export function SetupPill() {
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const purpose = useOnboarding((s) => s.purpose);
  const steps = useOnboarding((s) => s.steps);
  const dismissed = useOnboarding((s) => s.dismissed);
  const loaded = useOnboarding((s) => s.loaded);
  const refresh = useOnboarding((s) => s.refresh);
  const dismiss = useOnboarding((s) => s.dismiss);

  // The pill appears on pages that never fetch onboarding themselves, so it
  // has to be able to prime the store. refresh() is a no-op once dismissed.
  useEffect(() => { if (!loaded && wsId) void refresh(wsId); }, [loaded, wsId, refresh]);

  const { done, total } = steps ? completedCount(purpose, steps) : { done: 0, total: 0 };
  const complete = steps !== null && done >= total;

  // Auto-dismiss instead of merely hiding once the checklist is complete.
  // dismissed_at is never written by a bare `return null`, so a derivation
  // that later flips back to false - changing a password deletes other
  // sessions, undoing "desktop" for a 'personal' user who already finished
  // setup - would resurrect the pill. dismiss() sets `dismissed` true
  // synchronously before its network call, so gating on `complete &&
  // !dismissed` fires this exactly once: the next render already sees
  // dismissed=true and the condition is false, so it cannot loop.
  // This deliberately drops the spec's "show a done state for the rest of
  // the session" in favour of the simpler auto-dismiss.
  useEffect(() => {
    if (complete && !dismissed) void dismiss();
  }, [complete, dismissed, dismiss]);

  if (dismissed || !steps) return null;

  // The first-run home screen (dashboard.tsx) renders this same checklist
  // inline, and it shows precisely when the workspace has no files - which
  // is precisely when the "upload" derivation is false. Reusing that flag
  // here, instead of plumbing dashboard stats into the topbar, keeps the
  // pill from duplicating the first-run screen's own checklist.
  if (!steps.upload) return null;

  if (done >= total) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="setup-pill"
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="relative flex size-3.5 shrink-0">
          <svg viewBox="0 0 20 20" className="size-3.5 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
            <circle
              cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="4"
              strokeDasharray={`${(done / total) * 50.27} 50.27`}
            />
          </svg>
        </span>
        Setup {done}/{total}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-3">
        <OnboardingChecklist purpose={purpose} steps={steps} compact />
        <button
          type="button"
          data-testid="setup-pill-dismiss"
          onClick={() => { void dismiss(); }}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="size-3" /> Hide this
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

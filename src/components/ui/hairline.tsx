import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLoadingPending } from '@/lib/loading-bar';

/** How long the finished line stays in the DOM for its fade-out to play. */
export const HAIRLINE_SETTLE_MS = 450;

/**
 * How long the counter may sit at zero before the line is declared done.
 * A page chunk resolving and that page's first fetch starting are two
 * separate waits with a render between them; without this grace the line
 * would complete, fade and restart from the left in the same breath.
 */
export const HAIRLINE_GRACE_MS = 80;

type State = 'idle' | 'running' | 'done';

/**
 * The two-pixel green line along the top edge of whatever is waiting.
 *
 * It renders nothing until something registers with the loading counter (see
 * lib/loading-bar), then eases most of the way across and holds there - it
 * does not know how long the wait is and does not pretend to - and completes
 * and fades once the counter has stayed at zero for a beat. Position it
 * inside a `relative` container; it pins itself to that container's top edge.
 *
 * A fresh run always starts from the left. If a new wait begins while the
 * previous line is still fading, the element is remounted (the key) so the
 * line never visibly shrinks back from 100%.
 */
export function Hairline({ className }: { className?: string }) {
  const pending = useLoadingPending();
  const [state, setState] = useState<State>(pending ? 'running' : 'idle');
  const [seen, setSeen] = useState(pending);
  const [cycle, setCycle] = useState(0);

  // Starting a run follows the counter during render (React's "adjusting
  // state when a prop changes" pattern) rather than in an effect, so the line
  // never paints one frame behind the counter. A wait that begins while the
  // line is still running simply joins it.
  if (pending !== seen) {
    setSeen(pending);
    if (pending && state !== 'running') {
      setState('running');
      setCycle((c) => c + 1);
    }
  }

  // Finishing is deferred by the grace period, and cancelled if anything
  // registers in the meantime.
  useEffect(() => {
    if (pending || state !== 'running') return;
    const timer = setTimeout(() => setState('done'), HAIRLINE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [pending, state]);

  useEffect(() => {
    if (state !== 'done') return;
    const timer = setTimeout(() => setState('idle'), HAIRLINE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'idle') return null;
  return (
    <div
      key={cycle}
      data-slot="hairline"
      data-state={state}
      aria-hidden="true"
      className={cn('hairline', className)}
    />
  );
}

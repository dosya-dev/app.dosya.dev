import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';

/**
 * How long a full-screen wait may run before the way out appears. A cold boot
 * far from the D1 primary takes a second or two; nothing healthy takes this.
 */
export const LOADING_ESCAPE_AFTER_MS = 10_000;

/**
 * The way out of a loader that never finishes.
 *
 * The boot gate and the route fallbacks wait on requests and chunk downloads
 * with no timeout of their own, so a request that hangs (a dropped connection,
 * a stalled proxy, a laptop waking from sleep) leaves the seal breathing
 * forever with nothing to press. After a while this shows a short line and a
 * Reload button under the mark. A reload starts every one of those waits
 * again from scratch, which is what fixes almost every stuck load.
 *
 * Absolutely positioned under the mark so the seal does not jump when it
 * appears: render it as a sibling of the SealLoader inside a `relative`
 * wrapper that is centred the same way.
 */
export function LoadingEscape({ afterMs = LOADING_ESCAPE_AFTER_MS }: { afterMs?: number }) {
  const t = useT();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), afterMs);
    return () => window.clearTimeout(t);
  }, [afterMs]);

  if (!show) return null;

  return (
    <div
      data-slot="loading-escape"
      className="absolute left-1/2 top-full mt-6 flex w-72 -translate-x-1/2 flex-col items-center gap-3 text-center animate-in fade-in duration-300"
    >
      <p className="text-sm text-muted-foreground">{t('common.description.thisIsTakingLongerThanItShould')}</p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        {t('common.action.reload')}
      </Button>
    </div>
  );
}

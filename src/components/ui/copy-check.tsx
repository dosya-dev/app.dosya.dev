import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';

interface CopyCheckProps {
  /** The call site owns the copied state and its own reset timer. */
  copied: boolean;
  /** Sizing for both icons, e.g. "size-3.5". Anything else here lands on the wrapper. */
  className?: string;
  /** Extra classes for the confirmation tick, usually a green. */
  checkClassName?: string;
}

/**
 * The copy-confirmation tick.
 *
 * Ten places in the app confirm a copy, and every one of them used to REPLACE
 * the icon: `copied ? <Check/> : <Copy/>`. A replaced element cannot animate -
 * one node leaves the DOM and a different node appears in its place - so the
 * app's most repeated success moment had no motion at all.
 *
 * Both icons are always mounted, stacked in one grid cell, and cross-faded.
 * 140ms is the press-feedback tier: this confirms something the user just did,
 * so it has to land almost immediately or it stops reading as a response to
 * the click.
 *
 * The tick scales up from 0.6 rather than from nothing - things that appear
 * from zero read as a glitch rather than as an arrival.
 */
export function CopyCheck({ copied, className, checkClassName }: CopyCheckProps) {
  return (
    <span aria-hidden className={cn('relative inline-grid shrink-0 place-items-center', className)}>
      <Copy
        className={cn(
          'col-start-1 row-start-1 size-full transition-[opacity,transform] duration-[140ms] ease-(--ease-out-strong) motion-reduce:transition-[opacity]',
          copied ? 'scale-[0.8] opacity-0' : 'scale-100 opacity-100'
        )}
      />
      <Check
        className={cn(
          'col-start-1 row-start-1 size-full transition-[opacity,transform] duration-[140ms] ease-(--ease-out-strong) motion-reduce:transition-[opacity]',
          copied ? 'scale-100 opacity-100' : 'scale-[0.6] opacity-0',
          checkClassName
        )}
      />
    </span>
  );
}

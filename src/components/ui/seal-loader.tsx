import { cn } from '@/lib/utils';

/**
 * sm 14px: inside a button, next to its label.
 * md 20px: where a block of content will land (a list, a panel).
 * lg 28px: a route's content area while its chunk downloads.
 * xl 40px: the boot gate, when there is nothing else on screen.
 */
const SIZES = {
  sm: 'size-3.5',
  md: 'size-5',
  lg: 'size-7',
  xl: 'size-10',
} as const;

interface SealLoaderProps {
  size?: keyof typeof SIZES;
  /** Read out by screen readers. The visual carries no text on purpose. */
  label?: string;
  /**
   * Hold the loader invisible for the first 150ms. For Suspense fallbacks and
   * anything else that usually resolves at once: a cached chunk or a warm
   * query would otherwise flash the mark for a frame, which reads as a glitch.
   */
  delay?: boolean;
  className?: string;
}

/**
 * The one loading mark in the app: the dosya folder with its seal breathing.
 *
 * Replaces the bare grey ring that used to sit in the boot gate, both route
 * fallbacks and most inline waits. The folder stays still and the seal does
 * the work - scale and opacity only, no rotation - so it can loop for minutes
 * without wearing on anyone. The animation lives in index.css next to the
 * other motion rules and their reduced-motion policy.
 */
export function SealLoader({ size = 'md', label = 'Loading', delay = false, className }: SealLoaderProps) {
  return (
    <span
      role="status"
      data-slot="seal-loader"
      data-size={size}
      className={cn('inline-flex items-center justify-center', delay && 'seal-loader-delayed', className)}
    >
      <svg viewBox="0 0 24 24" className={cn('seal-loader', SIZES[size])} aria-hidden="true">
        <path
          d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2l2.1 2.6h6.7A2.5 2.5 0 0 1 21 10.1v7.4A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <circle className="seal-loader-ping" cx="16.6" cy="14.6" r="2.1" />
        <circle className="seal-loader-dot fill-[#16a34a] dark:fill-[#22c55e]" cx="16.6" cy="14.6" r="2.1" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

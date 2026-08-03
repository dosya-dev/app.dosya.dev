import { useDemo } from '../engine/demoState';
import { IconX } from './icons';

// offset lets shells place the toast clear of their own bottom chrome
// (the mobile tab bar); pointer-events-none on the wrapper keeps the
// invisible full-width strip from swallowing clicks on elements below it.
export function DemoToast({ offset = 'bottom-3' }: { offset?: string }) {
  const { state, dispatch } = useDemo();
  if (!state.toast) return null;
  return (
    <div className={`pointer-events-none absolute inset-x-0 ${offset} z-50 flex justify-center px-4`}>
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-(--demo-border) bg-(--demo-card) px-4 py-2 text-xs shadow-xl">
        <span className="truncate">{state.toast.text}</span>
        {/* ctaHref is null inside the tour: the viewer already has an
            account, so the CTA text shows with no link to follow. */}
        {state.toast.cta && state.ctaHref && (
          <a href={state.ctaHref} className="shrink-0 font-semibold text-(--demo-primary) hover:underline">Sign up free</a>
        )}
        <button aria-label="Dismiss" onClick={() => dispatch({ type: 'TOAST', toast: null })}
          className="shrink-0 text-(--demo-muted-fg) hover:text-(--demo-fg)">
          <IconX className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

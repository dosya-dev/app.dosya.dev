import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { stepsFor, type Purpose } from './steps';
import type { StepFlags } from '@/stores/onboarding';

interface OnboardingChecklistProps {
  purpose: Purpose | null;
  steps: StepFlags;
  /** Topbar popover variant: titles and state only, no reasons. */
  compact?: boolean;
}

/**
 * Counts progress across ONLY the active purpose's steps. A user whose
 * account happens to satisfy a derivation outside their set (geotagged
 * photos when they picked "dev") must not see phantom progress.
 */
export function completedCount(purpose: Purpose | null, steps: StepFlags): { done: number; total: number } {
  const active = stepsFor(purpose);
  return { done: active.filter((s) => steps[s.key]).length, total: active.length };
}

export function OnboardingChecklist({ purpose, steps, compact = false }: OnboardingChecklistProps) {
  const active = stepsFor(purpose);
  const { done, total } = completedCount(purpose, steps);

  // Only the false→true transition gets the pop. The previous flags start as
  // null so nothing animates on mount: a user coming back to a half-finished
  // checklist should not watch four steps celebrate themselves again, and the
  // onboarding fetch re-renders this on every visit.
  const prevSteps = useRef<StepFlags | null>(null);
  useEffect(() => { prevSteps.current = steps; }, [steps]);
  const justCompleted = (key: keyof StepFlags) =>
    prevSteps.current !== null && !prevSteps.current[key] && !!steps[key];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-medium">Get set up</p>
        <span className="text-xs text-muted-foreground">{done} of {total}</span>
      </div>

      <ul className="space-y-1.5">
        {active.map((step) => {
          const isDone = steps[step.key];
          const popped = justCompleted(step.key);
          const external = step.href.startsWith('https://');
          return (
            <li
              key={step.key}
              data-testid={`step-${step.key}`}
              data-done={isDone ? 'true' : 'false'}
              className="flex items-start gap-3 p-2.5 rounded-lg border"
            >
              <span
                aria-hidden
                className={`mt-0.5 size-4 rounded-full border flex items-center justify-center shrink-0 ${
                  isDone ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'
                } ${popped ? 'animate-step-done' : ''}`}
              >
                {isDone && <Check className={`size-3 ${popped ? 'animate-step-check' : ''}`} />}
              </span>

              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${isDone ? 'text-muted-foreground line-through' : ''}`}>
                  {step.title}
                </p>
                {!compact && !isDone && (
                  <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{step.why}</p>
                )}
              </div>

              {!isDone && (
                external ? (
                  <a href={step.href} target="_blank" rel="noreferrer">
                    <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">{step.cta}</Button>
                  </a>
                ) : (
                  <Link to={step.href}>
                    <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">{step.cta}</Button>
                  </Link>
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

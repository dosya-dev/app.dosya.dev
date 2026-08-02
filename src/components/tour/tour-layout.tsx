import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TourStep } from './tour-steps';

/**
 * Isolates the demo preview from the rest of the page.
 *
 * The previews are vendored components carrying their own state machine. If
 * one throws, the tour must still show its copy and its Next button - a blank
 * screen with no way forward is the one outcome this flow cannot have, since
 * the user is redirected here and has nothing else to look at.
 *
 * A class component because React error boundaries have no hook equivalent.
 */
class DemoBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Tour preview failed', error, info.componentStack);
  }

  render() {
    // Nothing in its place on purpose. A broken-image apology would draw the
    // eye to the failure; the copy column is what matters here.
    if (this.state.failed) return null;
    return this.props.children;
  }
}

interface TourLayoutProps {
  step: TourStep;
  index: number;
  total: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  /** The demo panel for this page. */
  preview: ReactNode;
  /** Page-specific controls under the copy, such as the theme picker. */
  extra?: ReactNode;
}

/**
 * The tour's frame: copy on the left, preview on the right.
 *
 * 35/65 rather than a narrower copy column. At 1440px a 20% column is about
 * 280px - narrower than the app's own sidebar - and four headed points wrap
 * badly in it. Below lg the two stack, preview under copy, because on a phone
 * the words are what carry the page.
 */
export function TourLayout({
  step, index, total, onBack, onNext, onSkip, preview, extra,
}: TourLayoutProps) {
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <span className="inline-flex items-center gap-2 font-mono italic font-semibold">
          <img src="/logo.svg" alt="" className="h-6 w-6" />
          dosya.dev
        </span>
        <button
          type="button"
          data-testid="tour-skip"
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip
        </button>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[35fr_65fr] gap-8 px-6 pb-6 items-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-bold tracking-tight mb-6">{step.heading}</h1>

          <ul className="space-y-4">
            {step.points.map((p) => (
              <li key={p.title}>
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-sm text-muted-foreground leading-snug">{p.body}</p>
              </li>
            ))}
          </ul>

          {extra && <div className="mt-6">{extra}</div>}

          <div className="flex items-center gap-2 mt-8">
            {!isFirst && (
              <Button variant="outline" data-testid="tour-back" onClick={onBack} className="gap-1.5">
                <ArrowLeft className="size-4" /> Back
              </Button>
            )}
            <Button data-testid="tour-next" onClick={onNext} className="gap-1.5">
              {isLast ? <><Check className="size-4" /> Finish</> : <>Next <ArrowRight className="size-4" /></>}
            </Button>
          </div>

          <div className="flex items-center gap-1.5 mt-8" aria-label={`Step ${index + 1} of ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                data-testid={`tour-dot-${i}`}
                data-current={i === index ? 'true' : 'false'}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-6 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <DemoBoundary>{preview}</DemoBoundary>
        </div>
      </main>
    </div>
  );
}

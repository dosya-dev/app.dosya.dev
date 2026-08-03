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

      {/*
        lg:items-start (rather than centring) is what stops the copy column
        from being vertically centred inside a row as tall as the preview
        stack - that centring is what pushed the heading, and with it the
        Next button, down past the fold on page 1 (WebDemo + Desktop/Mobile
        demos stack to ~1430px there). Below lg the two panes stack instead
        of sitting side by side, so alignment has no visible effect.
      */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[35fr_65fr] gap-8 px-6 pb-6 lg:items-start">
        {/*
          lg:min-h-screen gives the sticky nav below room to travel: a sticky
          element can only move within its containing block, so without a
          height floor here a short page (few points, no preview) would give
          it nowhere to go. It is a MIN height, so it never clips content -
          it only pads out short pages, which costs a little unused space
          under the dots on those pages in exchange for not having to guess
          any individual page's content height.
        */}
        <div className="max-w-md lg:min-h-screen">
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

          {/*
            Sticky rather than a fixed bottom bar: it stays part of the copy
            column's normal flow (no overlay, no extra reserved space needed
            elsewhere) but is pinned just above the viewport's bottom edge
            once the page has scrolled that far, on any page whose preview
            column happens to be taller than the copy. bg-background covers
            the points list if the two ever cross.
          */}
          <div className="mt-8 lg:sticky lg:bottom-6 lg:bg-background lg:pt-2">
            <div className="flex items-center gap-2">
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
        </div>

        {/*
          lg:max-h-screen + overflow-hidden caps the row's own height: without
          it, a tall preview stack (page 1) grows the page to whatever height
          it needs, taking the copy column and the sticky nav's travel range
          along with it. Cropping over squashing so the demos stay undistorted.
        */}
        <div className="min-w-0 lg:max-h-screen lg:overflow-hidden">
          <DemoBoundary>{preview}</DemoBoundary>
        </div>
      </main>
    </div>
  );
}

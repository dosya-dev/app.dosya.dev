// The Personas progress card above the grid. Photos are read on this device,
// so the card speaks for this device: "Read {read} of {total} photos on this
// device" with a bar and Pause / Resume, gone once every photo is read. A
// browser that cannot run the reader says so; the grid still works from the
// encrypted journal the user's other devices write. The rules live in
// lib/personas-progress.ts; this file only renders.
import { useId } from 'react';
import { Loader2, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { progressPercent, progressView, type ReadyStatus } from '@/lib/personas-progress';

export interface ProgressCardProps {
  status: ReadyStatus;
  /** Whether this browser can read photos (engine-host personasReaderSupported). */
  supported: boolean;
  /** Pause (true) or resume (false) reading on this device. */
  onPause: (paused: boolean) => void;
}

export function PersonasProgressCard({ status, supported, onPause }: ProgressCardProps) {
  const t = useT();
  const titleId = useId();
  const view = progressView(status, supported);
  if (view === 'hidden') return null;

  const frame = 'rounded-2xl border bg-card px-5 py-4 sm:px-6 sm:py-5 flex flex-col gap-3';
  const icon = (
    <span className="shrink-0 size-10 rounded-xl bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-500 flex items-center justify-center">
      <ScanFace className="size-5" aria-hidden="true" />
    </span>
  );

  if (view === 'unsupported') {
    return (
      <section aria-labelledby={titleId} data-progress-state="unsupported" className={frame}>
        <div className="flex items-center gap-3.5">
          {icon}
          <p id={titleId} className="flex-1 min-w-0 text-sm text-muted-foreground">{t('personas.description.thisBrowserCantReadPhotos')}</p>
        </div>
      </section>
    );
  }

  if (view === 'finding') {
    return (
      <section aria-labelledby={titleId} data-progress-state="finding" className={frame}>
        <div className="flex items-center gap-3.5">
          {icon}
          <p id={titleId} className="flex-1 min-w-0 text-sm font-semibold">{t('personas.label.findingYourPhotos')}</p>
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      </section>
    );
  }

  const total = status.total ?? 0;
  const percent = progressPercent(status);
  const line = t('personas.label.readOfTotalPhotosOnThisDevice', { read: status.read, total });
  return (
    <section aria-labelledby={titleId} data-progress-state="reading" className={frame}>
      <div className="flex flex-wrap items-center gap-3.5">
        {icon}
        <p id={titleId} className="flex-1 min-w-40 text-sm font-semibold">{line}</p>
        <Button variant="outline" size="sm" onClick={() => onPause(!status.paused)}>
          {status.paused ? t('personas.action.resume') : t('personas.action.pause')}
        </Button>
      </div>
      <div
        role="progressbar"
        aria-label={t('personas.label.photosRead')}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={status.read}
        aria-valuetext={line}
        className="h-2 rounded-full bg-border overflow-hidden"
      >
        <div className="h-full rounded-full bg-green-700 dark:bg-green-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

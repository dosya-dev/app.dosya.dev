import { useEffect, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

const LABELS: Record<string, MessageKey> = {
  web: 'common.label.theWebApp',
  desktop: 'common.label.theDesktopApp',
  mobile: 'common.label.theMobileApp',
  api: 'common.label.theDosyaApi',
};
const INTERVAL_S = 60;

export function MaintenanceScreen({ surface, message, onRetry, email, onSignOut }: {
  surface: string;
  message: string | null;
  onRetry: () => Promise<boolean>;
  email?: string | null;
  onSignOut?: () => void;
}) {
  const t = useT();
  const [left, setLeft] = useState(INTERVAL_S);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    if (checking) return;
    setChecking(true);
    try {
      await onRetry();
    } finally {
      setChecking(false);
      setLeft(INTERVAL_S);
    }
  };

  useEffect(() => {
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (left === 0) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const progress = ((INTERVAL_S - left) / INTERVAL_S) * 100;

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center bg-background text-foreground px-6 py-10 text-center"
      data-testid="maintenance-screen"
    >
      <div className="h-14 w-14 rounded-2xl border border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 flex items-center justify-center mb-5">
        <Wrench className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight mb-2">
        {t('common.heading.labelssurfacethisIsPausedForMaintenance', { LABELSSurfaceThis: LABELS[surface] ? t(LABELS[surface]) : t('common.label.thisService') })}
      </h1>
      <p className="text-muted-foreground max-w-md mb-5">
        {t('common.description.nothingYouUploadedIsAffectedWeLlBringTheDashboardBackOn')}
      </p>
      {message && (
        <div className="w-full max-w-md text-start rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-4 mb-6">
          <div className="text-[11px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">
            {t('common.label.fromTheTeam')}
          </div>
          <div dir="auto" className="whitespace-pre-wrap">{message}</div>
        </div>
      )}
      <div className="w-full max-w-xs h-1 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full bg-amber-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="font-mono text-sm text-muted-foreground tabular-nums mb-4">
        {checking ? t('common.status.checking') : t('common.label.checkingAgainInMmSs', { mm, ss })}
      </div>
      <div className="flex flex-wrap gap-3 justify-center">
        <Button onClick={check} disabled={checking}>
          <RefreshCw className="h-4 w-4 me-2" />
          {t('common.action.checkNow')}
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href="https://status.dosya.dev" target="_blank" rel="noopener noreferrer" />}
        >
          {t('common.action.statusPage')}
        </Button>
      </div>
      {email && (
        <div className="mt-10 pt-4 border-t w-full max-w-md text-sm text-muted-foreground">
          {t('common.label.signedInAs')} {email}
          {onSignOut && (
            <>
              {' '}
              ·{' '}
              <button className="underline underline-offset-2" onClick={onSignOut}>
                {t('common.action.signOut')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

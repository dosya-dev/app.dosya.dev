import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Smartphone } from 'lucide-react';
import { api } from '@/api/client';
import { readCache } from '@/lib/theme';
import { TOUR_STEPS } from '@/components/tour/tour-steps';
import { TourLayout } from '@/components/tour/tour-layout';
import { ThemeStep } from '@/components/tour/theme-step';
import { ReferralStep } from '@/components/tour/referral-step';
// All three demos are default exports - verified in the vendored copy.
import WebDemo from '@/components/demo/WebDemo';
import DesktopDemo from '@/components/demo/DesktopDemo';
import MobileDemo from '@/components/demo/MobileDemo';

/**
 * The full-screen welcome tour.
 *
 * Registered OUTSIDE DashboardLayout, which is what makes bootDashboard's
 * redirect to this route safe: the page never re-enters the boot gate, so
 * there is no loop to fall into.
 *
 * This component owns navigation and nothing else. Copy lives in tour-steps,
 * the frame in tour-layout, and the two interactive pages in their own files.
 */
export default function WelcomePage() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [demoTheme, setDemoTheme] = useState<string>(() => readCache().theme);

  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  // Leaving always succeeds. A failed PATCH means the boot gate may offer the
  // tour once more, which is strictly better than stranding someone on it.
  const finish = useCallback(async () => {
    try {
      await api('/api/onboarding', {
        method: 'PATCH',
        body: JSON.stringify({ tour_completed: true }),
      });
    } catch { /* leave anyway */ }
    navigate('/', { replace: true });
  }, [navigate]);

  const onNext = useCallback(() => {
    if (isLast) { void finish(); return; }
    setIndex((i) => i + 1);
  }, [isLast, finish]);

  return (
    <div data-demo-theme={demoTheme}>
      <TourLayout
        step={step}
        index={index}
        total={TOUR_STEPS.length}
        onBack={() => setIndex((i) => Math.max(0, i - 1))}
        onNext={onNext}
        onSkip={() => { void finish(); }}
        extra={
          step.id === 'welcome' ? (
            <div className="space-y-5">
              <ThemeStep onThemeChange={setDemoTheme} />
              <div className="flex flex-wrap items-center gap-2">
                <a href="https://dosya.dev/desktop" target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium hover:bg-muted/50 transition-colors">
                  <Download className="size-3.5" /> Download for desktop
                </a>
                {/* The mobile app is not on the App Store yet, so this is a
                    link to the product page, not a download. When it ships,
                    this becomes a store link and nothing else changes. */}
                <a href="https://dosya.dev/mobile" target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-xs font-medium text-muted-foreground hover:bg-muted/50 transition-colors">
                  <Smartphone className="size-3.5" /> Mobile app, coming to the App Store
                </a>
              </div>
            </div>
          ) : step.id === 'ready' ? (
            <ReferralStep />
          ) : undefined
        }
        preview={
          step.id === 'welcome' ? (
            <div className="space-y-4">
              <WebDemo />
              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-4">
                <DesktopDemo />
                <MobileDemo />
              </div>
            </div>
          ) : (
            <WebDemo />
          )
        }
      />
    </div>
  );
}

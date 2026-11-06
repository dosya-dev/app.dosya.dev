// App entry - mounts the router. Deployed to app.dosya.dev via the sync-web workflow.
// Crash reporting must initialise before router.tsx is evaluated - keep this first.
import './instrument';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { router } from './router';
import { queryClient } from '@/lib/query-client';
import { installPreloadRecovery } from '@/lib/preload-recovery';
import { installTranslateGuard } from '@/lib/translate-guard';
import { logConsoleGreeting } from '@/lib/console-greeting';
import { I18nProvider, bootI18n } from '@/lib/i18n';
import './index.css';

installPreloadRecovery();
// Before the first render: browser page translation must not crash a screen.
installTranslateGuard();

// The stored language's messages are loaded before the first render, so a
// non-English visitor never sees an English frame.
void bootI18n().then(({ locale, messages }) => {
  // After the language is active, so the console message is in it.
  logConsoleGreeting();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <I18nProvider initial={locale} initialMessages={messages}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </QueryClientProvider>
      </I18nProvider>
    </StrictMode>,
  );
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW registration failed', err));
  });
}

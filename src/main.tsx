// App entry - mounts the router. Deployed to app.dosya.dev via the sync-web workflow.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { router } from './router';
import { queryClient } from '@/lib/query-client';
import { recoverFromChunkErrorInBrowser } from '@/lib/chunk-reload';
import './index.css';

// Vite fires this when a lazy chunk's preload fails, which after a deploy means
// the tab is asking for hashed filenames that no longer exist. Catching it here
// recovers before the router's error boundary ever paints an error page. The
// boundary keeps its own copy of this check for the paths that skip the event.
window.addEventListener('vite:preloadError', (event) => {
  const err = (event as Event & { payload?: unknown }).payload ?? event;
  if (recoverFromChunkErrorInBrowser(err)) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('SW registration failed', err));
  });
}

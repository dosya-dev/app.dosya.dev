// main.tsx's FIRST import, on purpose: ES module imports are evaluated in
// order, and router.tsx (imported later by main.tsx) wraps createBrowserRouter
// with Sentry's instrumentation, which only works once Sentry.init has run.
// Nothing else belongs in this file.
import { initSentry } from '@/lib/sentry';

initSentry();

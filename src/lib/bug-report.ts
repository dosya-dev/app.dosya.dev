// What a bug report carries besides the user's words. Spec:
// docs/superpowers/specs/2026-10-03-bug-report-design.md. The server
// re-validates (apps/api/src/lib/support-diagnostics.ts); this is the
// client half, and the card the user reads before Send.

import { t } from '@/lib/i18n';

export const BUILD_SHA: string = typeof __BUILD_SHA__ === 'string' && __BUILD_SHA__ ? __BUILD_SHA__ : 'dev';

/** The marketing version people see in release notes. The web app ships
 *  continuously, so the build sha is the real identifier; this is a label. */
export const APP_VERSION = 'web';

export interface WebDiagnostics {
  v: 1;
  client: 'web';
  app_version: string;
  build: string | null;
  platform: string;
  locale: string | null;
  workspace_id: string | null;
  page: string | null;
  error_ref: string | null;
  error_message: string | null;
  extra: Record<string, string>;
  captured_at: number;
}

export interface DiagnosticsInput {
  workspaceId?: string | null;
  page?: string | null;
  errorRef?: string | null;
  /** Never a file name, a path, or a URL carrying a query string - the card
   *  tells the user nothing from their files is included, and this is the
   *  one field a caller could break that promise with. */
  errorMessage?: string | null;
  userAgent?: string;
  locale?: string | null;
  now?: number;
}

const orNull = (v: string | null | undefined): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** The path only. Share tokens and unlock tokens travel in the query string. */
function pathOnly(p: string | null): string | null {
  return p === null ? null : p.split(/[?#]/)[0];
}

export function collectDiagnostics(input: DiagnosticsInput = {}): WebDiagnostics {
  const hasWindow = typeof window !== 'undefined';
  return {
    v: 1,
    client: 'web',
    app_version: APP_VERSION,
    build: BUILD_SHA,
    platform: input.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'),
    locale: input.locale !== undefined ? orNull(input.locale) : (typeof navigator !== 'undefined' ? orNull(navigator.language) : null),
    workspace_id: orNull(input.workspaceId),
    page: pathOnly(input.page !== undefined ? orNull(input.page) : (hasWindow ? window.location.pathname : null)),
    error_ref: orNull(input.errorRef),
    error_message: orNull(input.errorMessage),
    extra: {},
    captured_at: input.now ?? Math.floor(Date.now() / 1000),
  };
}

/** The rows the card shows the user. Empty values are left out; the id is
 *  "Error reference", never the vendor's name. */
export function diagnosticsRows(d: WebDiagnostics): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: t('report-problem.label.app'), value: `${d.app_version} · build ${d.build ?? 'dev'}` },
    { label: t('common.label.browser'), value: d.platform },
    { label: t('common.label.workspace'), value: d.workspace_id },
    { label: t('report-problem.label.page'), value: d.page },
    { label: t('report-problem.label.errorReference'), value: d.error_ref },
    { label: t('error-page.label.error'), value: d.error_message },
    ...Object.entries(d.extra).map(([label, value]) => ({ label, value })),
  ];
  return rows.filter((r): r is { label: string; value: string } => typeof r.value === 'string' && r.value.length > 0);
}

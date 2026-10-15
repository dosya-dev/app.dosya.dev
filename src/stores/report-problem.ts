import { create } from 'zustand';

// One dialog, opened from anywhere: the account menu, the error page, a failed
// toast's "Report" action. The toast module is not React, hence the plain
// `openReport()` export beside the hook.

export interface ReportPrefill {
  /** The Sentry event id, shown to the user as "Error reference". */
  errorRef?: string | null;
  errorMessage?: string | null;
  /** Route path when the failure happened somewhere other than the current page. */
  page?: string | null;
}

interface ReportProblemState {
  open: boolean;
  prefill: ReportPrefill;
  openReport: (prefill?: ReportPrefill) => void;
  closeReport: () => void;
}

export const useReportProblem = create<ReportProblemState>((set) => ({
  open: false,
  prefill: {},
  openReport: (prefill = {}) => set({ open: true, prefill }),
  closeReport: () => set({ open: false }),
}));

export function openReport(prefill?: ReportPrefill): void {
  useReportProblem.getState().openReport(prefill);
}

import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bug, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AttachImages } from '@/components/support/attach-images';
import { createTicket } from '@/api/support';
import { apiErrorMessage } from '@/api/client';
import { toast } from '@/lib/toast';
import { collectDiagnostics, diagnosticsRows } from '@/lib/bug-report';
import { LIMITS, validateTicketBody } from '@/lib/validation-policy.generated';
import { useReportProblem } from '@/stores/report-problem';
import { useWorkspace } from '@/stores/workspace';

/**
 * The bug-report form (spec: direction B's form, A's destination). One text
 * field, screenshots, a diagnostics card the user can untick, Send. No subject:
 * the server derives it. Mount once per router tree; open it with openReport().
 */
export function ReportProblemDialog() {
  const open = useReportProblem((s) => s.open);
  const prefill = useReportProblem((s) => s.prefill);
  const closeReport = useReportProblem((s) => s.closeReport);
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const location = useLocation();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [include, setInclude] = useState(true);
  const [sending, setSending] = useState(false);

  // Fresh every time it opens: a second report should not carry the first's
  // text. Adjusted during render - React's documented alternative to an
  // Effect for "reset state when a prop changes" (react.dev/reference/react/
  // useState#storing-information-from-previous-renders) - rather than a
  // useEffect, so the reset lands before the first paint instead of racing a
  // flash of stale text.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setText(''); setFiles([]); setInclude(true); setSending(false); }
  }

  // `prefill` is a fresh object every time openReport() is called, so this
  // re-runs on every open - which is what gives captured_at a fresh
  // timestamp per open. A memoised prefill reference would freeze this
  // instead of recomputing it.
  const diagnostics = useMemo(() => collectDiagnostics({
    workspaceId: wsId || null,
    page: prefill.page ?? location.pathname,
    errorRef: prefill.errorRef ?? null,
    errorMessage: prefill.errorMessage ?? null,
  }), [wsId, prefill, location.pathname]);
  const rows = useMemo(() => diagnosticsRows(diagnostics), [diagnostics]);

  if (!open) return null;

  const send = async () => {
    const body = text.trim();
    const bodyError = validateTicketBody(body);
    if (bodyError) { toast.error('Could not send report', bodyError); return; }
    setSending(true);
    try {
      const res = await createTicket({
        subject: '',
        category: 'bug',
        body,
        workspaceId: wsId || undefined,
        images: files,
        diagnostics: include ? JSON.stringify(diagnostics) : undefined,
      });
      closeReport();
      toast.success('Report sent', 'Thank you. We reply at your account email and under Support.');
      navigate(`/support/${res.ticket.id}`);
    } catch (err) {
      toast.error('Could not send report', apiErrorMessage(err, 'Please try again in a moment.'));
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sending) closeReport(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bug className="size-4" /> Report a bug</DialogTitle>
          <DialogDescription>One or two sentences is enough. The details below travel with it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
            placeholder="What went wrong? What did you expect instead?"
            rows={4}
            maxLength={LIMITS.TICKET_BODY_MAX}
            autoFocus
            aria-label="What went wrong"
          />
          <AttachImages files={files} onChange={setFiles} disabled={sending} />
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-medium"><Info className="size-4" /> Diagnostics</div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={include}
                  onCheckedChange={(v) => setInclude(v === true)}
                  data-testid="include-diagnostics"
                  aria-label="Include diagnostics"
                />
                Include
              </label>
            </div>
            <dl className="mt-2 divide-y">
              {rows.map((r, i) => (
                <div key={`${i}-${r.label}`} className="flex justify-between gap-4 py-1.5">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="font-mono text-xs text-right break-all">{r.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Nothing from your files is included.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={sending} onClick={closeReport}>Cancel</Button>
          <Button onClick={send} disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send report'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

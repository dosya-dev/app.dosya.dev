import { formatNumber, localDigits } from '@/lib/format-locale';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchTickets, createTicket, type TicketSummary, type TicketCategory } from '@/api/support';
import { apiErrorMessage } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { categoryOptions, categoryLabel, StatusBadge } from '@/components/support/ticket-meta';
import { AttachImages } from '@/components/support/attach-images';
import { toast } from '@/lib/toast';
import { LIMITS, validateTicketSubject, validateTicketBody } from '@/lib/validation-policy.generated';
import { translateExternal } from '@/lib/external-text';
import { timeAgo } from '@/lib/helpers';
import { useDocumentTitle } from '@/lib/page-title';
import { Plus, ExternalLink, MessageSquare, MessageCircle, Bug } from 'lucide-react';
import { useSession } from '@/stores/session';
import { useSupportChat } from '@/stores/support-chat';
import { PresenceDot } from '@/components/support-chat/panel';
import { openReport } from '@/stores/report-problem';
import { useT } from '@/lib/i18n';

const LINK_SLOT = '\u0000';

type Tab = 'open' | 'closed';

export default function SupportPage() {
  const t = useT();
  useDocumentTitle(t('support.label.getHelp'));
  const CATEGORY_OPTIONS = categoryOptions();
  const navigate = useNavigate();
  const chatEnabled = useSession((s) => !!s.user?.features?.support_chat);
  const staffOnline = useSupportChat((s) => s.staffOnline);
  const openPanel = useSupportChat((s) => s.openPanel);
  const refreshSummary = useSupportChat((s) => s.refreshSummary);
  useEffect(() => { if (chatEnabled) void refreshSummary(); }, [chatEnabled, refreshSummary]);
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);

  const [tab, setTab] = useState<Tab>('open');
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [counts, setCounts] = useState<{ open: number; closed: number }>({ open: 0, closed: 0 });
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('technical');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchTickets(tab);
        if (!alive) return;
        setTickets(data.tickets);
        setCounts(data.counts);
      } catch (err) {
        if (alive) toast.error(t('support.error.couldNotLoadTickets'), apiErrorMessage(err));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [tab]);

  const submit = async () => {
    if (!subject.trim() || !body.trim() || submitting) return;
    // 200 and 10,000. Both were server-only, so a long paste was uploaded in
    // full and refused. The counters below warn before this fires.
    const subjectError = validateTicketSubject(subject);
    if (subjectError) { toast.error(t('support.error.couldNotCreateTicket'), translateExternal(subjectError, 'toast')); return; }
    const bodyError = validateTicketBody(body);
    if (bodyError) { toast.error(t('support.error.couldNotCreateTicket'), translateExternal(bodyError, 'toast')); return; }
    setSubmitting(true);
    try {
      const res = await createTicket({
        subject: subject.trim(), category, body: body.trim(),
        workspaceId: wsId || undefined, images: files,
      });
      toast.success(t('support.feedback.ticketCreated'), t('support.feedback.ourSupportTeamWillGetBackToYou'));
      navigate(`/support/${res.ticket.id}`);
    } catch (err) {
      toast.error(t('support.error.couldNotCreateTicket'), apiErrorMessage(err));
      setSubmitting(false);
    }
  };

  const TABS: { value: Tab; label: string; count: number }[] = [
    { value: 'open', label: t('common.status.open'), count: counts.open },
    { value: 'closed', label: t('support.label.closed'), count: counts.closed },
  ];

  // The Help center link sits where the message puts {link1}, so a language can move it.
  const [before, after = ''] = t('support.description.openATicketAndOurSupportTeamWillGetBackTo', { link1: LINK_SLOT }).split(LINK_SLOT);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto">
          {chatEnabled && (
            <div className="mb-5 flex items-center gap-3 rounded-xl border bg-card p-3.5">
              <MessageCircle className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {t('support.heading.liveChat')} <PresenceDot online={staffOnline} />
                </p>
                <p className="text-sm text-muted-foreground">{t('support.description.chatWithUsInRealTimeWhileYouWork')}</p>
              </div>
              <Button variant="outline" onClick={openPanel}>{t('support.action.openChat')}</Button>
            </div>
          )}
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">{t('support.heading.getHelp')}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {before}
                <a href="https://dosya.dev/help" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground hover:underline">
                  {t('support.action.helpCenter')} <ExternalLink className="size-3" />
                </a>
                {after}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="gap-2" onClick={() => openReport()}>
                <Bug className="size-4" /> {t('common.action.reportABug')}
              </Button>
              <Button onClick={() => { setSubject(''); setCategory('technical'); setBody(''); setFiles([]); setDialogOpen(true); }}>
                <Plus className="size-3.5 me-1.5" /> {t('support.action.newTicket')}
              </Button>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line" className="w-full justify-start gap-0.5 border-b p-0 group-data-horizontal/tabs:h-auto">
              {TABS.map((tb) => (
                <TabsTrigger
                  key={tb.value}
                  value={tb.value}
                  className="flex-none gap-0 rounded-none px-4 py-2 text-sm group-data-horizontal/tabs:after:-bottom-px"
                >
                  {tb.label}
                  <span className={`ms-1.5 text-[10px] font-semibold rounded-full px-1.5 py-px ${
                    tab === tb.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                  }`}>
                    {localDigits(tb.count)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {loading ? (
            <div className="space-y-3 mt-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium text-muted-foreground">
                {tab === 'open' ? t('support.label.noOpenTickets') : t('support.label.noClosedTickets')}
              </p>
              {tab === 'open' && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t('support.description.somethingNotWorkingOpenATicketAndWeLlHelp')}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-1">
              {tickets.map((tk) => (
                <Link
                  key={tk.id}
                  to={`/support/${tk.id}`}
                  className="flex items-center gap-3 py-3 border-b last:border-b-0 group"
                >
                  <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <MessageSquare className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:underline">{tk.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('support.action.categoryLabelstcategoryTmessageCountPluralOneMessageOtherMessages', {
                        CATEGORY_LABELSTCategory: categoryLabel(tk.category),
                        tMessage_count: tk.message_count,
                        tLast_message_at: timeAgo(tk.last_message_at),
                      })}
                    </p>
                  </div>
                  <StatusBadge status={tk.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {dialogOpen && (
        <Dialog open onOpenChange={() => !submitting && setDialogOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{t('support.heading.newSupportTicket')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input
                value={subject}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
                placeholder={t('support.placeholder.subject')}
                maxLength={LIMITS.TICKET_SUBJECT_MAX}
                autoFocus
              />
              <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)} items={CATEGORY_OPTIONS}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={body}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
                placeholder={t('support.placeholder.describeTheProblemWhatDidYouExpectWhatHappenedInstead')}
                rows={5}
                maxLength={LIMITS.TICKET_BODY_MAX}
              />
              {/* maxLength stops typing at the cap but says nothing on the way
                  there, so a long paste silently loses its tail. Same last-10%
                  rule as the comment composer. */}
              {body.length > LIMITS.TICKET_BODY_MAX * 0.9 && (
                <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                  {formatNumber(body.length)} / {formatNumber(LIMITS.TICKET_BODY_MAX)}
                </p>
              )}
              <AttachImages files={files} onChange={setFiles} disabled={submitting} />
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={submitting} onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
              <Button onClick={submit} disabled={submitting || !subject.trim() || !body.trim()}>
                {submitting ? t('support.status.creating') : t('support.action.createTicket')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

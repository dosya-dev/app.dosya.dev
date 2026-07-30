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
import { CATEGORY_OPTIONS, CATEGORY_LABELS, StatusBadge } from '@/components/support/ticket-meta';
import { AttachImages } from '@/components/support/attach-images';
import { toast } from '@/lib/toast';
import { timeAgo } from '@/lib/helpers';
import { useDocumentTitle } from '@/lib/page-title';
import { Plus, ExternalLink, MessageSquare } from 'lucide-react';

type Tab = 'open' | 'closed';

export default function SupportPage() {
  useDocumentTitle('Get help');
  const navigate = useNavigate();
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
        if (alive) toast.error('Could not load tickets', apiErrorMessage(err));
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [tab]);

  const submit = async () => {
    if (!subject.trim() || !body.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await createTicket({
        subject: subject.trim(), category, body: body.trim(),
        workspaceId: wsId || undefined, images: files,
      });
      toast.success('Ticket created', 'Our support team will get back to you.');
      navigate(`/support/${res.ticket.id}`);
    } catch (err) {
      toast.error('Could not create ticket', apiErrorMessage(err));
      setSubmitting(false);
    }
  };

  const TABS: { value: Tab; label: string; count: number }[] = [
    { value: 'open', label: 'Open', count: counts.open },
    { value: 'closed', label: 'Closed', count: counts.closed },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-2xl mx-auto">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Get help</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Open a ticket and our support team will get back to you.{' '}
                <a href="https://dosya.dev/help" target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground hover:underline">
                  Help center <ExternalLink className="size-3" />
                </a>
              </p>
            </div>
            <Button onClick={() => { setSubject(''); setCategory('technical'); setBody(''); setFiles([]); setDialogOpen(true); }}>
              <Plus className="size-3.5 mr-1.5" /> New ticket
            </Button>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line" className="w-full justify-start gap-0.5 border-b p-0 group-data-horizontal/tabs:h-auto">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="flex-none gap-0 rounded-none px-4 py-2 text-sm group-data-horizontal/tabs:after:-bottom-px"
                >
                  {t.label}
                  <span className={`ml-1.5 text-[10px] font-semibold rounded-full px-1.5 py-px ${
                    tab === t.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                  }`}>
                    {t.count}
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
                {tab === 'open' ? 'No open tickets' : 'No closed tickets'}
              </p>
              {tab === 'open' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Something not working? Open a ticket and we'll help.
                </p>
              )}
            </div>
          ) : (
            <div className="mt-1">
              {tickets.map((t) => (
                <Link
                  key={t.id}
                  to={`/support/${t.id}`}
                  className="flex items-center gap-3 py-3 border-b last:border-b-0 group"
                >
                  <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <MessageSquare className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate group-hover:underline">{t.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[t.category] ?? t.category}
                      {' · '}{t.message_count} message{t.message_count === 1 ? '' : 's'}
                      {' · '}{timeAgo(t.last_message_at)}
                    </p>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {dialogOpen && (
        <Dialog open onOpenChange={() => !submitting && setDialogOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New support ticket</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input
                value={subject}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
                placeholder="Subject"
                maxLength={200}
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
                placeholder="Describe the problem - what did you expect, what happened instead?"
                rows={5}
                maxLength={10000}
              />
              <AttachImages files={files} onChange={setFiles} disabled={submitting} />
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={submitting} onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={submitting || !subject.trim() || !body.trim()}>
                {submitting ? 'Creating…' : 'Create ticket'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

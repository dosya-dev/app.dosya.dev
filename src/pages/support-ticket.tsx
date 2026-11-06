import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchTicket, replyTicket, closeTicket,
  type TicketDetail, type TicketMessage,
} from '@/api/support';
import { api, API_BASE, apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { categoryLabel, StatusBadge } from '@/components/support/ticket-meta';
import { AttachImages } from '@/components/support/attach-images';
import { toast } from '@/lib/toast';
import { timeAgo, initials } from '@/lib/helpers';
import { useDocumentTitle } from '@/lib/page-title';
import { ChevronLeft, Copy } from 'lucide-react';
import { Logo } from "@/components/brand/logo";
import { useT } from '@/lib/i18n';

export default function SupportTicketPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [me, setMe] = useState<{ id: string; name: string; avatar_url: string | null } | null>(null);

  useEffect(() => {
    api<{ ok: boolean; user: { id: string; name: string; avatar_url: string | null } }>('/api/me')
      .then((r) => { if (r.ok) setMe(r.user); })
      .catch(() => { /* avatar falls back to initials */ });
  }, []);

  useDocumentTitle(ticket?.subject ? t('support-ticket.label.ticketsubjectSupport', { ticketSubject: ticket.subject }) : t('common.label.support'));

  // Initial load with alive guard
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const data = await fetchTicket(id);
        if (!alive) return;
        setTicket(data.ticket);
        setMessages(data.messages);
      } catch {
        if (alive) setNotFound(true);
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  // Refresh function for post-action updates
  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const data = await fetchTicket(id);
      setTicket(data.ticket);
      setMessages(data.messages);
    } catch (err) {
      toast.error(t('support-ticket.error.couldNotRefreshTheTicket'), apiErrorMessage(err));
    }
  }, [id, t]);

  const send = async () => {
    if (!id || !body.trim() || sending) return;
    setSending(true);
    try {
      await replyTicket(id, body.trim(), files);
      setBody('');
      setFiles([]);
      await refresh();
    } catch (err) {
      toast.error(t('support-ticket.error.replyFailed'), apiErrorMessage(err));
    }
    setSending(false);
  };

  const close = async () => {
    if (!id || closing) return;
    setClosing(true);
    try {
      await closeTicket(id);
      await refresh();
      setConfirmClose(false);
      toast.success(t('support-ticket.feedback.ticketClosed'), t('support-ticket.feedback.youCanReopenItAnytimeByReplying'));
    } catch (err) {
      toast.error(t('support-ticket.error.closeFailed'), apiErrorMessage(err));
    }
    setClosing(false);
  };

  const backLink = (
    <Link to="/support" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
      <ChevronLeft className="size-3.5 rtl:-scale-x-100" /> {t('support-ticket.action.backToTickets')}
    </Link>
  );

  if (notFound) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        {backLink}
        <Card className="gap-0 py-12 text-center text-sm text-muted-foreground">
          {t('support-ticket.description.thisTicketDoesNotExistOrYouDoNotHaveAccess')}
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {backLink}

      {loading || !ticket ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3 mb-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold truncate">{ticket.subject}</h1>
                <StatusBadge status={ticket.status} />
              </div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                {categoryLabel(ticket.category)} {t('support-ticket.label.opened')} {timeAgo(ticket.created_at)} ·
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(ticket.id);
                    toast.success(t('support-ticket.action.ticketIdCopied'), t('support-ticket.action.quoteItAnywhereYouContactUsAndWeCanFollowUp'));
                  }}
                  className="inline-flex items-center gap-1 font-mono hover:text-foreground"
                  title={t('support-ticket.action.copyTicketId')}
                >
                  {ticket.id} <Copy className="size-3" />
                </button>
              </p>
            </div>
            {ticket.status !== 'closed' && (
              <Button variant="outline" size="sm" disabled={closing} onClick={() => setConfirmClose(true)}>
                {t('support-ticket.action.closeTicket')}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-4 mb-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex items-start gap-2.5 max-w-[85%] ${m.author_type === 'user' ? 'self-end flex-row-reverse' : 'self-start'}`}
              >
                {m.author_type === 'user' ? (
                  <div className="size-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-semibold overflow-hidden shrink-0 mt-4">
                    {me?.avatar_url ? (
                      <img src={`${API_BASE}/api/me/avatar?u=${encodeURIComponent(me.id)}`} alt="" crossOrigin="use-credentials" className="w-full h-full object-cover" />
                    ) : (
                      initials(me?.name || '?')
                    )}
                  </div>
                ) : (
                  // Our side always shows the dosya logo - never a staff member's name/photo.
                  <div className="size-7 rounded-full bg-background border flex items-center justify-center shrink-0 mt-4">
                    <Logo className="size-4" aria-label="dosya" />
                  </div>
                )}
                <div className={`flex flex-col min-w-0 ${m.author_type === 'user' ? 'items-end' : 'items-start'}`}>
                  <p className="text-[11px] text-muted-foreground mb-1">
                    {m.author_type === 'staff' ? t('common.label.support') : (me?.name || t('common.label.you'))}
                    {' · '}{timeAgo(m.created_at)}
                  </p>
                  <div className={`rounded-xl px-4 py-3 text-sm whitespace-pre-wrap break-words ${
                    m.author_type === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}>
                    {m.body}
                    {m.attachments.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {m.attachments.map((a) => (
                          <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                            <img src={a.url} alt={a.file_name} className="size-24 rounded-lg object-cover border" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {ticket.status === 'closed' && (
            <Card className="gap-0 px-4 py-3 mb-4 text-xs text-muted-foreground bg-muted/50">
              {t('support-ticket.description.thisTicketWasClosedTicketclosedBystaffSelectTrueByOurSupportTeam', { ticketClosed_byStaff: ticket.closed_by === 'staff' ? 'true' : 'false' })}
            </Card>
          )}

          <div className="border rounded-xl p-3 space-y-2.5">
            <Textarea
              value={body}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
              placeholder={t('support-ticket.placeholder.writeAReply')}
              rows={3}
              maxLength={10000}
            />
            <div className="flex items-center justify-between gap-2">
              <AttachImages files={files} onChange={setFiles} disabled={sending} />
              <Button onClick={send} disabled={sending || !body.trim()}>
                {sending ? t('common.status.sending') : t('support-ticket.action.sendReply')}
              </Button>
            </div>
          </div>

          {confirmClose && (
            <Dialog open onOpenChange={() => !closing && setConfirmClose(false)}>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>{t('support-ticket.heading.closeThisTicket')}</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  {t('support-ticket.description.thisMarksTheConversationAsResolvedYouCanReopenItAnytime')}
                </p>
                <DialogFooter>
                  <Button variant="outline" disabled={closing} onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
                  <Button disabled={closing} onClick={close}>
                    {closing ? t('support-ticket.action.closing') : t('support-ticket.action.closeTicket')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </>
      )}
    </div>
  );
}

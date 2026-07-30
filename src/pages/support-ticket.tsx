import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchTicket, replyTicket, closeTicket,
  type TicketDetail, type TicketMessage,
} from '@/api/support';
import { apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { CATEGORY_LABELS, StatusBadge } from '@/components/support/ticket-meta';
import { AttachImages } from '@/components/support/attach-images';
import { toast } from '@/lib/toast';
import { timeAgo } from '@/lib/helpers';
import { useDocumentTitle } from '@/lib/page-title';
import { ChevronLeft } from 'lucide-react';

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  useDocumentTitle(ticket?.subject ? `${ticket.subject} · Support` : 'Support');

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
      toast.error('Could not refresh the ticket', apiErrorMessage(err));
    }
  }, [id]);

  const send = async () => {
    if (!id || !body.trim() || sending) return;
    setSending(true);
    try {
      await replyTicket(id, body.trim(), files);
      setBody('');
      setFiles([]);
      await refresh();
    } catch (err) {
      toast.error('Reply failed', apiErrorMessage(err));
    }
    setSending(false);
  };

  const close = async () => {
    if (!id || closing) return;
    setClosing(true);
    try {
      await closeTicket(id);
      await refresh();
      toast.success('Ticket closed', 'You can reopen it anytime by replying.');
    } catch (err) {
      toast.error('Close failed', apiErrorMessage(err));
    }
    setClosing(false);
  };

  const backLink = (
    <Link to="/support" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
      <ChevronLeft className="size-3.5" /> Back to tickets
    </Link>
  );

  if (notFound) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        {backLink}
        <Card className="gap-0 py-12 text-center text-sm text-muted-foreground">
          This ticket does not exist or you do not have access to it.
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
              <p className="text-xs text-muted-foreground mt-1">
                {CATEGORY_LABELS[ticket.category] ?? ticket.category} · Opened {timeAgo(ticket.created_at)}
              </p>
            </div>
            {ticket.status !== 'closed' && (
              <Button variant="outline" size="sm" disabled={closing} onClick={close}>
                {closing ? 'Closing…' : 'Close ticket'}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-4 mb-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col max-w-[85%] ${m.author_type === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
              >
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
                <p className="text-[11px] text-muted-foreground mt-1">
                  {m.author_type === 'staff' ? (m.author_name || 'dosya.dev Support') : 'You'}
                  {' · '}{timeAgo(m.created_at)}
                </p>
              </div>
            ))}
          </div>

          {ticket.status === 'closed' && (
            <Card className="gap-0 px-4 py-3 mb-4 text-xs text-muted-foreground bg-muted/50">
              This ticket was closed{ticket.closed_by === 'staff' ? ' by our support team' : ''}.
              Sending a new message will reopen it.
            </Card>
          )}

          <div className="border rounded-xl p-3 space-y-2.5">
            <Textarea
              value={body}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBody(e.target.value)}
              placeholder="Write a reply…"
              rows={3}
              maxLength={10000}
            />
            <div className="flex items-center justify-between gap-2">
              <AttachImages files={files} onChange={setFiles} disabled={sending} />
              <Button onClick={send} disabled={sending || !body.trim()}>
                {sending ? 'Sending…' : 'Send reply'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

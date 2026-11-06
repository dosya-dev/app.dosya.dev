import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { chatAttachmentUrl } from '@/api/support-chat';
import { useSupportChat } from '@/stores/support-chat';
import { useLocale, useT } from '@/lib/i18n';
import type { ChatMessage } from '@/lib/support-chat/types';
import type { ThreadMessage } from '@/stores/support-chat';
import { cn } from '@/lib/utils';
import { PersonaAvatar } from './persona-avatar';

function dayKey(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The scrolling message list: day separators, bubbles, system lines, typing dots.
 * `messages` overrides the live store (the read-only history of a lapsed plan).
 */
export function Thread({ className, messages: fixed }: { className?: string; messages?: ThreadMessage[] }) {
  const t = useT();
  const { locale } = useLocale();
  const live = useSupportChat((s) => s.messages);
  const messages = fixed ?? live;
  const typing = useSupportChat((s) => s.typing);
  const typingName = useSupportChat((s) => s.typingName);
  const pending = useSupportChat((s) => s.pending);
  const staffSeenAt = useSupportChat((s) => s.staffSeenAt);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  const todayKey = dayKey(Math.floor(Date.now() / 1000));
  const dayLabel = (sec: number) => (dayKey(sec) === todayKey
    ? t('support-chat.label.today')
    : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(sec * 1000)));
  const lastOwn = [...messages].reverse().find((m) => m.author_type === 'user');

  const ownStatus = (m: ChatMessage): string => {
    if (pending[m.id] === 'uploading' || pending[m.id] === 'sending') return t('support-chat.status.sending');
    if (m.created_at <= staffSeenAt) return t('support-chat.status.seen');
    return t('support-chat.status.sent');
  };

  return (
    <div ref={ref} role="log" aria-live="polite" className={cn('flex flex-col gap-2 overflow-y-auto p-3', className)}>
      {messages.map((m, i) => {
        const showDay = i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at);
        return (
          <div key={m.id} className="flex flex-col gap-2">
            {showDay && (
              <div className="self-center text-[11px] text-muted-foreground py-1">{dayLabel(m.created_at)}</div>
            )}
            {m.author_type === 'system' ? (
              <SystemLine message={m} />
            ) : (
              <Bubble message={m} status={m.id === lastOwn?.id ? ownStatus(m) : null} />
            )}
          </div>
        );
      })}
      {typing && (
        <div className="self-start flex items-center gap-2" role="status">
          <div className="flex gap-1 rounded-2xl border bg-card px-3 py-2.5" aria-hidden="true">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="size-1.5 rounded-full bg-muted-foreground animate-bounce motion-reduce:animate-none"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {t('support-chat.status.personaIsTyping', { name: typingName || t('support-chat.heading.dosyaSupport') })}
          </span>
        </div>
      )}
    </div>
  );
}

function Bubble({ message: m, status }: { message: ThreadMessage; status: string | null }) {
  const own = m.author_type === 'user';
  const persona = !own ? m.persona ?? null : null;
  return (
    <div className={cn('flex gap-2 max-w-[85%]', own ? 'self-end' : 'self-start')}>
      {persona && <PersonaAvatar persona={persona} size={24} className="mt-0.5" />}
      <div className={cn('flex min-w-0 flex-col gap-0.5', own ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
          own ? 'bg-primary text-primary-foreground' : 'bg-card border',
        )}
        dir="auto"
      >
        {m.body}
        {m.previews ? m.previews.map((p) => (
          // The sender's own images, shown from memory from the moment Send was pressed.
          p.url ? (
            <a key={p.key} href={p.url} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
              <img src={p.url} alt={p.name} className="max-h-48 rounded-lg" />
            </a>
          ) : (
            <span key={p.key} className="block mt-1.5 text-xs opacity-80">{p.name}</span>
          )
        )) : m.attachments.map((a) => (
          <a key={a.id} href={chatAttachmentUrl(a.id)} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
            <img src={chatAttachmentUrl(a.id)} alt={a.file_name} loading="lazy" crossOrigin="use-credentials" className="max-h-48 rounded-lg" />
          </a>
        ))}
      </div>
      {status && <span className="text-[11px] text-muted-foreground px-1">{status}</span>}
      </div>
    </div>
  );
}

function SystemLine({ message: m }: { message: ChatMessage }) {
  const t = useT();
  let text = m.body;
  let link: string | null = null;
  if (m.kind === 'ticket_created') {
    const num = m.meta?.ticket_number;
    text = t('support-chat.description.weOpenedTicketTicketnumberForThis', { ticketNumber: String(num ?? '') });
    if (typeof m.meta?.ticket_id === 'string') link = `/support/${m.meta.ticket_id}`;
  } else if (m.kind === 'persona_joined') {
    const who = m.meta?.persona_name;
    if (typeof who === 'string' && who) text = t('support-chat.description.personaJoinedTheConversation', { name: who });
  } else if (m.kind === 'closed') {
    // Whoever ended it, the conversation is over (a reply no longer reopens it); the body is the admin's English.
    text = t('support-chat.label.conversationEnded');
  }
  return (
    <div className="self-center text-center text-xs text-muted-foreground flex flex-col items-center gap-0.5">
      <span>{text}</span>
      {link && (
        <Link to={link} className="font-medium text-(--brand-text) underline-offset-2 hover:underline focus-visible:underline outline-none">
          {t('support-chat.action.viewTicket')}
        </Link>
      )}
    </div>
  );
}

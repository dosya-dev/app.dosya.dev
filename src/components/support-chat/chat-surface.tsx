import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, History, Minus, MoreVertical, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSupportChat } from '@/stores/support-chat';
import { useSession } from '@/stores/session';
import { useT } from '@/lib/i18n';
import { Thread } from './thread';
import { Composer } from './composer';
import { RatingCard } from './rating-card';
import { ConversationsSheet } from './conversations-sheet';
import { PersonaAvatar, PresenceDot } from './persona-avatar';

const iconBtn = 'size-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The seven days the server allows for rating an ended conversation. */
const RATING_WINDOW_SEC = 7 * 24 * 3600;

/**
 * Everything inside the chat frame: header, banners, thread or a past
 * conversation, the rating card / composer and the conversations sheet.
 * The floating panel and the /support/chat page both render it.
 */
export function ChatSurface({ variant }: { variant: 'panel' | 'page' }) {
  const t = useT();
  const navigate = useNavigate();
  const plan = useSession((s) => s.user?.plan?.name ?? '');
  const conn = useSupportChat((s) => s.conn);
  const staffOnline = useSupportChat((s) => s.staffOnline);
  const personaOnline = useSupportChat((s) => s.personaOnline);
  const persona = useSupportChat((s) => s.persona);
  const conversation = useSupportChat((s) => s.conversation);
  const viewing = useSupportChat((s) => s.viewing);
  const historyMessages = useSupportChat((s) => s.historyMessages);
  const history = useSupportChat((s) => s.history);
  const muted = useSupportChat((s) => s.muted);
  const lastError = useSupportChat((s) => s.lastError);
  // The room refuses to end a conversation nobody wrote in (system lines do not count).
  const somethingSaid = useSupportChat((s) => s.messages.some((m) => m.author_type !== 'system'));
  const minimizePanel = useSupportChat((s) => s.minimizePanel);
  const closePanel = useSupportChat((s) => s.closePanel);
  const endConversation = useSupportChat((s) => s.endConversation);
  const startConversation = useSupportChat((s) => s.startConversation);
  const rate = useSupportChat((s) => s.rate);
  const toggleMute = useSupportChat((s) => s.toggleMute);
  const viewConversation = useSupportChat((s) => s.viewConversation);
  const clearError = useSupportChat((s) => s.clearError);

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const pastView = viewing !== null && viewing !== conversation?.id;
  const pastItem = pastView ? history.find((h) => h.id === viewing) ?? null : null;
  const ended = conversation?.status === 'ended';
  const name = persona?.name ?? null;
  const canEnd = !ended && !!conversation && somethingSaid;

  let status: string;
  if (ended) status = t('support-chat.label.conversationEnded');
  else if (persona) status = personaOnline ? t('support-chat.status.personaIsOnline', { name: persona.name }) : t('support-chat.status.personaIsAway', { name: persona.name });
  else status = staffOnline ? t('support-chat.status.onlineUsuallyRepliesInAFewMinutes') : t('support-chat.status.awayRepliesByPushAndEmail');
  const dotOnline = persona ? personaOnline : staffOnline;
  const away = persona ? !personaOnline : !staffOnline;
  const heading = persona ? t('support-chat.heading.personaFromDosya', { name: persona.name }) : t('support-chat.heading.dosyaSupport');
  const Heading = variant === 'page' ? 'h1' : 'h2';

  const startNew = () => { clearError(); void startConversation(); };
  const startButton = (
    <Button type="button" size="sm" variant="outline" className="self-stretch" onClick={startNew}>
      {t('support-chat.action.startANewConversation')}
    </Button>
  );

  const ratingClosed = (c: { ended_at: number | null } | null) =>
    lastError === 'rating_closed' || (c?.ended_at != null && Date.now() / 1000 - c.ended_at > RATING_WINDOW_SEC);

  let body;
  if (pastView) {
    body = (
      <>
        <Thread className="min-h-0 flex-1" messages={historyMessages} />
        <div className="flex flex-col gap-2 border-t p-2.5">
          {pastItem && pastItem.status === 'ended' && (
            <RatingCard
              name={pastItem.persona?.name ?? null}
              rating={pastItem.rating}
              closed={ratingClosed(pastItem)}
              onRate={rate}
            />
          )}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => void viewConversation(null)}>{t('support-chat.action.back')}</Button>
            <div className="flex-1">{startButton}</div>
          </div>
        </div>
      </>
    );
  } else if (ended) {
    body = (
      <>
        <Thread className="min-h-0 flex-1" />
        <div className="flex flex-col gap-2 border-t p-2.5">
          <RatingCard name={name} rating={conversation?.rating ?? null} closed={ratingClosed(conversation)} onRate={rate} />
          {lastError === 'too_many_conversations' && (
            <p role="alert" className="text-xs text-muted-foreground">{t('support-chat.description.youHaveStartedTooManyConversationsToday')}</p>
          )}
          {startButton}
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Thread className="min-h-0 flex-1" />
        <Composer />
      </>
    );
  }

  return (
    <>
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        {persona && <PersonaAvatar persona={persona} size={32} />}
        <div className="min-w-0 flex-1">
          <Heading className="truncate text-sm font-semibold leading-5">{heading}</Heading>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {!ended && <PresenceDot online={dotOnline} />}
            <span className="truncate">{status}</span>
          </p>
        </div>
        <button
          type="button"
          className={iconBtn}
          aria-pressed={muted}
          aria-label={muted ? t('support-chat.action.unmuteSounds') : t('support-chat.action.muteSounds')}
          title={muted ? t('support-chat.action.unmuteSounds') : t('support-chat.action.muteSounds')}
          onClick={toggleMute}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <button type="button" className={iconBtn} title={t('support-chat.action.conversations')} onClick={() => setSheetOpen(true)}>
          <History className="size-4" aria-hidden="true" />
          <span className="sr-only">{t('support-chat.action.conversations')}</span>
        </button>
        {(canEnd || variant === 'panel') && (
        <div ref={menuRef} className="relative" onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false); }}>
          <button
            type="button"
            className={iconBtn}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={t('support-chat.action.moreOptions')}
            title={t('support-chat.action.moreOptions')}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <MoreVertical className="size-4" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute end-0 top-8 z-20 min-w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
              {canEnd && (
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  className="block w-full rounded px-2 py-1.5 text-start outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => { setMenuOpen(false); setConfirmEnd(true); }}
                >
                  {t('support-chat.action.endConversation')}
                </button>
              )}
              {variant === 'panel' && (
                <button
                  type="button"
                  role="menuitem"
                  autoFocus={!canEnd}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start outline-none hover:bg-accent focus-visible:bg-accent"
                  onClick={() => { setMenuOpen(false); navigate('/support/chat'); }}
                >
                  <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
                  {t('support-chat.action.openAsAPage')}
                </button>
              )}
            </div>
          )}
        </div>
        )}
        {variant === 'panel' && (
          <>
            <button type="button" className={iconBtn} aria-label={t('support-chat.action.minimize')} title={t('support-chat.action.minimize')} onClick={minimizePanel}>
              <Minus className="size-4" />
            </button>
            <button type="button" className={iconBtn} aria-label={t('support-chat.action.close')} title={t('support-chat.action.close')} onClick={closePanel}>
              <X className="size-4" />
            </button>
          </>
        )}
      </header>
      {confirmEnd && (
        <div role="alertdialog" aria-label={t('support-chat.action.endConversation')} className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs">
          <p className="flex-1">{t('support-chat.description.endThisConversation')}</p>
          <Button type="button" size="sm" variant="destructive" autoFocus onClick={() => { setConfirmEnd(false); endConversation(); }}>{t('common.yes')}</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmEnd(false)}>{t('common.no')}</Button>
        </div>
      )}
      {(conn === 'reconnecting' || conn === 'polling') && (
        <div role="status" className="bg-muted px-3 py-1 text-center text-xs text-muted-foreground">{t('support-chat.status.reconnecting')}</div>
      )}
      {away && !ended && !pastView && (
        <p className="border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t('support-chat.description.weReAwayRightNow')}</p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {body}
        {sheetOpen && <ConversationsSheet onClose={() => setSheetOpen(false)} />}
      </div>
      {variant === 'panel' && (
        <footer className="border-t px-3 py-1.5 text-center text-[11px] text-muted-foreground">
          {t('support-chat.label.yourPlanPlanConversationsAreKeptWithYourSupportTickets', { plan })}
        </footer>
      )}
    </>
  );
}

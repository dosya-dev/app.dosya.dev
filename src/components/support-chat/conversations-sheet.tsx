import { useEffect } from 'react';
import { Star, X } from 'lucide-react';
import { useSupportChat } from '@/stores/support-chat';
import { useLocale, useT } from '@/lib/i18n';
import { PersonaAvatar } from './persona-avatar';

/** Slides over the panel body: past and current conversations, newest first. */
export function ConversationsSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const history = useSupportChat((s) => s.history);
  const loadHistory = useSupportChat((s) => s.loadHistory);
  const viewConversation = useSupportChat((s) => s.viewConversation);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  return (
    <div
      role="region"
      aria-label={t('support-chat.action.conversations')}
      className="absolute inset-0 z-10 flex flex-col bg-background motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">{t('support-chat.action.conversations')}</h3>
        <button
          type="button"
          autoFocus
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('support-chat.action.close')}
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      {history.length === 0 ? (
        <p className="p-4 text-center text-sm text-muted-foreground">{t('support-chat.label.noConversationsYet')}</p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {history.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-start outline-none hover:bg-accent focus-visible:bg-accent"
                onClick={() => { void viewConversation(c.id); onClose(); }}
              >
                {c.persona && <PersonaAvatar persona={c.persona} size={28} />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium" dir="auto">{c.title || t('support-chat.label.conversation')}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.persona ? `${c.persona.name} · ` : ''}{fmt.format(new Date(c.started_at * 1000))}
                  </span>
                </span>
                {c.rating && (
                  <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" aria-label={t('support-chat.label.starsOutOfFive', { count: c.rating.stars })}>
                    <Star aria-hidden="true" className="size-3.5 fill-amber-400 text-amber-400" />
                    <span aria-hidden="true">{c.rating.stars}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSession } from '@/stores/session';
import { useSupportChat } from '@/stores/support-chat';
import { setAttentionLabel } from '@/lib/support-chat/attention';
import { useT } from '@/lib/i18n';
import { ChatSurface } from './chat-surface';

export { PresenceDot } from './persona-avatar';

/** Mounted once in the dashboard layout. Connects through resume(); draws only while open. */
export function SupportChatPanel() {
  const t = useT();
  const onChatPage = useLocation().pathname === '/support/chat';
  const user = useSession((s) => s.user);
  const enabled = !!user?.features?.support_chat;
  const panel = useSupportChat((s) => s.panel);
  const resume = useSupportChat((s) => s.resume);
  const markSeen = useSupportChat((s) => s.markSeen);

  useEffect(() => { if (enabled) resume(); }, [enabled, resume]);
  useEffect(() => { if (enabled && panel === 'open') markSeen(); }, [enabled, panel, markSeen]);
  // The tab title prefix is a catalog string, so it follows the language.
  useEffect(() => {
    setAttentionLabel((count, name) => t('support-chat.label.newMessageFromName', { count, name }));
    return () => setAttentionLabel(null);
  }, [t]);

  if (!enabled || panel !== 'open' || onChatPage) return null;

  return (
    <section
      role="dialog"
      aria-label={t('support-chat.heading.dosyaSupport')}
      className="fixed bottom-4 end-4 z-50 flex h-[500px] max-h-[calc(100vh-2rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl"
    >
      <ChatSurface variant="panel" />
    </section>
  );
}

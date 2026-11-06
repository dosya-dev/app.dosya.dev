import { useEffect, useState } from 'react';
import { useSession } from '@/stores/session';
import { useSupportChat } from '@/stores/support-chat';
import { fetchChatMessages, fetchChatSummary } from '@/api/support-chat';
import { useDocumentTitle } from '@/lib/page-title';
import { useT } from '@/lib/i18n';
import type { ChatMessage } from '@/lib/support-chat/types';
import { Thread } from '@/components/support-chat/thread';
import { ChatSurface } from '@/components/support-chat/chat-surface';

// Upper bound on history pages for the read-only view (100 per page server side, 50 by default).
const HISTORY_MAX_PAGES = 40;

/**
 * Whole thread over REST, oldest first. `after` is exclusive on whole seconds,
 * so each page re-asks from one second earlier and duplicates are dropped by id;
 * a page that adds nothing ends the walk.
 */
async function loadHistory(): Promise<ChatMessage[]> {
  const byId = new Map<string, ChatMessage>();
  let after: number | undefined;
  for (let i = 0; i < HISTORY_MAX_PAGES; i++) {
    const page = await fetchChatMessages(after);
    let added = 0;
    for (const m of page) {
      if (!byId.has(m.id)) { byId.set(m.id, m); added++; }
    }
    if (added === 0 || page.length === 0) break;
    after = Math.max(1, page[page.length - 1].created_at - 1);
  }
  return [...byId.values()].sort((a, b) => a.created_at - b.created_at);
}

/** Live chat at page width. The floating panel hides on this route. */
export default function SupportChatPage() {
  const t = useT();
  useDocumentTitle(t('common.action.liveChat'));
  const enabled = useSession((s) => !!s.user?.features?.support_chat);
  // Read-only history for a lapsed plan (spec section 10); null until loaded or when there is none.
  const [history, setHistory] = useState<ChatMessage[] | null>(null);

  // Connection rule: if the panel was closed, open it so the socket connects,
  // and on leaving minimize it (socket stays, nothing floats). If it was already
  // open or minimized (e.g. "Open as a page"), it is left as found. Nothing here
  // ever calls closePanel, so moving between panel and page never reconnects.
  useEffect(() => {
    if (!enabled) return;
    const wasClosed = useSupportChat.getState().panel === 'closed';
    if (wasClosed) useSupportChat.getState().openPanel();
    return () => { if (wasClosed) useSupportChat.getState().minimizePanel(); };
  }, [enabled]);

  // The page renders the thread, so what arrives while it is up counts as seen.
  useEffect(() => {
    if (!enabled) return;
    useSupportChat.getState().setPageVisible(true);
    return () => useSupportChat.getState().setPageVisible(false);
  }, [enabled]);

  // Not enabled: a lapsed plan still reads its history over REST (no socket, no
  // panel). A 404 means no chat at all and keeps the plain paid-plans line.
  useEffect(() => {
    if (enabled) return;
    let alive = true;
    (async () => {
      try {
        const summary = await fetchChatSummary();
        if (!alive || summary.available || !summary.chat) return;
        const messages = await loadHistory();
        if (alive) setHistory(messages);
      } catch {
        // 404 or offline: nothing to show beyond the paid-plans line.
      }
    })();
    return () => { alive = false; };
  }, [enabled]);

  const paidPlansLine = t('support-chat.description.liveChatIsAvailableOnPaidPlans');

  if (!enabled && history === null) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 text-sm text-muted-foreground">
        {paidPlansLine}
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
          <ChatSurface variant="page" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-3 p-4">
      <h1 className="text-xl font-semibold">{t('support-chat.heading.dosyaSupport')}</h1>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
        <Thread className="min-h-0 flex-1" messages={history ?? []} />
        <p className="border-t p-3 text-sm text-muted-foreground">{paidPlansLine}</p>
      </div>
    </div>
  );
}

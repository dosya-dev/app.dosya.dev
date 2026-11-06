import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const { SupportChatPanel } = await import('./panel');
const { useSupportChat } = await import('@/stores/support-chat');
const { useSession } = await import('@/stores/session');
type ChatMessage = import('@/lib/support-chat/types').ChatMessage;

const USER = {
  id: 'u1', name: 'Firat', email: 'f@dosya.dev', avatar_url: null,
  deletion_scheduled_for: null, plan: { id: 'pro', name: 'Pro' }, features: { support_chat: true },
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = window.matchMedia ?? ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  } as unknown as MediaQueryList));
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const sendMock = vi.fn(async () => {});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  sendMock.mockClear();
  localStorage.clear();
});

function msg(p: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1', chat_id: 'c1', author_type: 'staff', author_id: null, author_name: 'Ada', kind: 'text',
    persona_id: null, body: 'hello', meta: null, attachments: [], created_at: Math.floor(Date.now() / 1000), ...p,
  };
}

async function mount(state: Record<string, unknown> = {}, user: unknown = USER) {
  useSession.setState({ user: user as never });
  useSupportChat.setState({
    panel: 'open', conn: 'open', staffOnline: true, unread: 0, messages: [], typing: false,
    notAvailable: false, pending: {}, lastFailedDraft: null,
    resume: () => {}, markSeen: () => {}, setTyping: () => {}, send: sendMock,
    ...state,
  } as never);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(MemoryRouter, null, createElement(SupportChatPanel)));
  });
}

function unmount() {
  act(() => root!.unmount());
  container!.remove();
  root = null;
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe('SupportChatPanel', () => {
  it('renders nothing when closed and the away banner when staff are offline', async () => {
    await mount({ panel: 'closed' });
    expect(dialog()).toBeNull();
    unmount();
    await mount({ staffOnline: false });
    expect(dialog()?.getAttribute('aria-label')).toBe('dosya support');
    expect(dialog()!.textContent).toContain("We're away right now.");
    expect(dialog()!.textContent).toContain('Away · replies by push and email');
    expect(dialog()!.textContent).toContain('Your plan: Pro');
  });

  it('renders nothing for a user without the feature flag', async () => {
    await mount({}, { ...USER, features: undefined });
    expect(dialog()).toBeNull();
  });

  it('Enter sends and Shift+Enter inserts a newline', async () => {
    await mount();
    const ta = dialog()!.querySelector('textarea')!;
    const setValue = (v: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(ta, v);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => { setValue('hi there'); });
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(sendMock).not.toHaveBeenCalled();
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(sendMock).toHaveBeenCalledWith('hi there', []);
  });

  it('replaces the composer with the paid-plans line when notAvailable', async () => {
    await mount({ notAvailable: true });
    expect(dialog()!.querySelector('textarea')).toBeNull();
    expect(dialog()!.textContent).toContain('Live chat is available on paid plans.');
  });

  it('shows a View ticket link for a ticket_created system message', async () => {
    await mount({
      messages: [msg({ id: 's1', author_type: 'system', kind: 'ticket_created', body: '', meta: { ticket_id: 'tk_9', ticket_number: 42 } })],
    });
    const a = dialog()!.querySelector<HTMLAnchorElement>('a[href="/support/tk_9"]');
    expect(a?.textContent).toBe('View ticket');
    expect(dialog()!.textContent).toContain('We opened ticket #42 for this.');
  });

  it('renders message bodies as text, not markup', async () => {
    await mount({ messages: [msg({ body: '<b>x</b>' })] });
    expect(dialog()!.querySelector('b')).toBeNull();
    expect(dialog()!.textContent).toContain('<b>x</b>');
  });

  describe('persona and conversation flow', () => {
    const ADA = { id: 'p1', name: 'Ada', title: null, avatar_url: null, active: true };
    const conv = (p: Record<string, unknown> = {}) => ({
      id: 'c1', status: 'answered', persona: ADA, ended_by: null, ended_at: null, rating: null, started_at: 1, ...p,
    });
    const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
    const byText = (txt: string, sel = 'button') =>
      Array.from(dialog()!.querySelectorAll<HTMLElement>(sel)).find((b) => b.textContent?.trim() === txt);

    it('shows the persona in the header and the typing line with their name', async () => {
      await mount({ conversation: conv(), persona: ADA, personaOnline: true, typing: true, typingName: 'Ada' });
      expect(dialog()!.textContent).toContain('Ada from dosya');
      expect(dialog()!.textContent).toContain('Ada is online · usually replies in a few minutes');
      expect(dialog()!.textContent).toContain('Ada is typing…');
    });

    it('shows the away line for an offline persona and a persona_joined system line', async () => {
      await mount({
        conversation: conv(), persona: ADA, personaOnline: false,
        messages: [msg({ id: 's2', author_type: 'system', kind: 'persona_joined', body: 'RAW ENGLISH BODY', meta: { persona_id: 'p1', persona_name: 'Ada' } })],
      });
      expect(dialog()!.textContent).toContain("Ada is away · they'll see this when they're back");
      // The translated line, built from meta.persona_name; the stored English body is never shown.
      expect(dialog()!.textContent).toContain('Ada joined the conversation');
      expect(dialog()!.textContent).not.toContain('RAW ENGLISH BODY');
    });

    it('shows every closed system line as Conversation ended, whoever ended it', async () => {
      await mount({
        conversation: conv(), persona: ADA,
        messages: [msg({ id: 's3', author_type: 'system', kind: 'closed', body: 'Ada ended this conversation', meta: { by: 'staff_1' } })],
      });
      const log = dialog()!.querySelector('[role="log"]')!;
      expect(log.textContent).toContain('Conversation ended');
      expect(log.textContent).not.toContain('Ada ended this conversation');
      expect(log.textContent).not.toContain('Reply to reopen it');
    });

    it('offers End conversation only once something has been said', async () => {
      await mount({ conversation: conv(), persona: ADA, messages: [] });
      await click(dialog()!.querySelector('[aria-haspopup="menu"]'));
      expect(byText('End conversation', '[role="menuitem"]')).toBeUndefined();
      expect(byText('Open as a page', '[role="menuitem"]')).toBeDefined();
    });

    it('End conversation asks inline, then ends, and the ended state shows the rating card', async () => {
      const end = vi.fn();
      await mount({ conversation: conv(), persona: ADA, endConversation: end, messages: [msg({})] });
      await click(dialog()!.querySelector('[aria-haspopup="menu"]'));
      await click(byText('End conversation', '[role="menuitem"]'));
      expect(dialog()!.textContent).toContain('End this conversation? You can start a new one any time.');
      await click(byText('Yes'));
      expect(end).toHaveBeenCalledTimes(1);
      await act(async () => { useSupportChat.setState({ conversation: conv({ status: 'ended', ended_by: 'user' }) as never }); });
      expect(dialog()!.textContent).toContain('How was your chat with Ada?');
      expect(dialog()!.textContent).toContain('Conversation ended');
      expect(dialog()!.querySelector('textarea[aria-label="Write a message"]')).toBeNull();
    });

    it('submits stars, solved and the comment, and Start resets', async () => {
      const rate = vi.fn(async () => {});
      const start = vi.fn();
      await mount({ conversation: conv({ status: 'ended', ended_by: 'user' }), persona: ADA, rate, startConversation: start });
      await click(dialog()!.querySelector('[aria-label="4 of 5 stars"]'));
      await click(byText('Yes'));
      const ta = dialog()!.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'great');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await click(byText('Send'));
      expect(rate).toHaveBeenCalledWith(4, true, 'great');
      await click(byText('Start a new conversation'));
      expect(start).toHaveBeenCalledTimes(1);
    });

    it('explains the daily conversation cap', async () => {
      await mount({ conversation: conv({ status: 'ended' }), persona: ADA, lastError: 'too_many_conversations' });
      expect(dialog()!.textContent).toContain("You've started a lot of conversations today. Try again tomorrow.");
    });

    it('lists past conversations in the sheet and opens one', async () => {
      const view = vi.fn(async () => {});
      const load = vi.fn(async () => {});
      await mount({
        conversation: conv(), persona: ADA, loadHistory: load, viewConversation: view,
        history: [{ ...conv({ id: 'c0', status: 'ended', rating: { stars: 5, solved: true, comment: null, created_at: 1 } }), title: 'Billing question', last_message_at: 1 }],
      });
      await click(byText('Conversations'));
      expect(load).toHaveBeenCalled();
      expect(dialog()!.textContent).toContain('Billing question');
      expect(dialog()!.textContent).toContain('Ada');
      await click(byText('Billing question', 'button') ?? Array.from(dialog()!.querySelectorAll('button')).find((b) => b.textContent?.includes('Billing question')));
      expect(view).toHaveBeenCalledWith('c0');
    });

    it('shows the empty state when there are no conversations', async () => {
      await mount({ conversation: conv(), persona: ADA, loadHistory: async () => {}, history: [] });
      await click(byText('Conversations'));
      expect(dialog()!.textContent).toContain('No conversations yet');
    });

    it('toggles mute and keeps it across mounts', async () => {
      await mount({ muted: false, toggleMute: useSupportChat.getState().toggleMute });
      const btn = () => dialog()!.querySelector<HTMLElement>('[aria-pressed][aria-label$="sounds"]')!;
      expect(btn().getAttribute('aria-label')).toBe('Mute sounds');
      await click(btn());
      expect(btn().getAttribute('aria-pressed')).toBe('true');
      expect(btn().getAttribute('aria-label')).toBe('Unmute sounds');
      expect(localStorage.getItem('dosya.supportChat.sound')).toBe('off');
    });
  });
});

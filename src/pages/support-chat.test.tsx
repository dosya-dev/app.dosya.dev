import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const rest = vi.hoisted(() => ({ fetchChatSummary: vi.fn(), fetchChatMessages: vi.fn() }));
vi.mock('@/api/support-chat', async (orig) => ({
  ...(await orig<typeof import('@/api/support-chat')>()),
  fetchChatSummary: rest.fetchChatSummary,
  fetchChatMessages: rest.fetchChatMessages,
}));

const { ApiError } = await import('@/api/client');
const { default: SupportChatPage } = await import('./support-chat');
const { SupportChatPanel } = await import('@/components/support-chat/panel');
const { useSupportChat, __setClientFactory } = await import('@/stores/support-chat');
const { useSession } = await import('@/stores/session');

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

beforeEach(() => {
  rest.fetchChatSummary.mockReset();
  rest.fetchChatMessages.mockReset();
  rest.fetchChatSummary.mockRejectedValue(new ApiError(404, 'Not found'));
  rest.fetchChatMessages.mockResolvedValue([]);
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const created = vi.fn();
const closed = vi.fn();

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  useSupportChat.getState().__reset();
  __setClientFactory(null);
  created.mockClear();
  closed.mockClear();
  localStorage.clear();
});

function useFakeClient() {
  __setClientFactory(() => {
    created();
    return { connect: () => {}, close: closed, send: () => {}, sendMessage: () => 'x', discard: () => {} };
  });
}

async function mount(user: unknown, path = '/support/chat') {
  useSession.setState({ user: user as never });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement('div', null,
      createElement(SupportChatPanel),
      createElement(Routes, null,
        createElement(Route, { path: '/support/chat', element: createElement(SupportChatPage) }),
        createElement(Route, { path: '*', element: createElement('div') }),
      ),
    )));
  });
}

describe('SupportChatPage', () => {
  it('shows the paid-plans line and never opens the panel or a socket without the feature flag', async () => {
    useFakeClient();
    await mount({ ...USER, features: undefined });
    expect(container!.textContent).toContain('Live chat is available on paid plans.');
    expect(container!.querySelector('textarea')).toBeNull();
    expect(useSupportChat.getState().panel).toBe('closed');
    expect(created).not.toHaveBeenCalled();
  });

  it('a lapsed plan with history reads its thread over REST, read-only: no composer, no panel, no socket', async () => {
    useFakeClient();
    const chat = {
      id: 'chat_1', user_id: 'u1', status: 'answered', last_message_at: 20, last_user_message_at: 10,
      last_staff_message_at: 20, user_last_seen_at: null, staff_last_seen_at: null, created_at: 1,
    };
    const msg = (id: string, author_type: 'user' | 'staff', body: string, created_at: number) => ({
      id, chat_id: 'chat_1', author_type, author_id: null, author_name: null, kind: 'text', body, meta: null, attachments: [], created_at,
    });
    rest.fetchChatSummary.mockResolvedValue({ available: false, chat, staff_online: false, unread: 0 });
    rest.fetchChatMessages.mockResolvedValueOnce([msg('m1', 'user', 'My upload fails', 10), msg('m2', 'staff', 'Try again now', 20)]);
    await mount({ ...USER, features: { support_chat: false } });
    expect(container!.textContent).toContain('My upload fails');
    expect(container!.textContent).toContain('Try again now');
    expect(container!.textContent).toContain('Live chat is available on paid plans.');
    expect(container!.querySelector('textarea')).toBeNull();
    expect(useSupportChat.getState().panel).toBe('closed');
    expect(created).not.toHaveBeenCalled();
  });

  it('marks the page visible while mounted and hidden after', async () => {
    useFakeClient();
    await mount(USER);
    expect(useSupportChat.getState().pageVisible).toBe(true);
    act(() => root!.unmount());
    root = null;
    expect(useSupportChat.getState().pageVisible).toBe(false);
  });

  it('a lapsed plan whose summary 404s keeps the paid-plans line and loads no messages', async () => {
    useFakeClient();
    await mount({ ...USER, features: { support_chat: false } });
    expect(rest.fetchChatSummary).toHaveBeenCalled();
    expect(rest.fetchChatMessages).not.toHaveBeenCalled();
    expect(container!.textContent).toContain('Live chat is available on paid plans.');
    expect(container!.querySelector('[role="log"]')).toBeNull();
  });

  it('opening the panel as a page keeps the same connection: one client, no close', async () => {
    useFakeClient();
    await mount(USER, '/dashboard');
    await act(async () => { useSupportChat.getState().openPanel(); });
    expect(created).toHaveBeenCalledTimes(1);
    await act(async () => { document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!.click(); });
    const openAsPage = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((b) => b.textContent?.includes('Open as a page'));
    await act(async () => { openAsPage!.click(); });
    expect(container!.querySelector('textarea')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useSupportChat.getState().panel).toBe('open');
    expect(created).toHaveBeenCalledTimes(1);
    expect(closed).not.toHaveBeenCalled();
  });

  it('visiting the page with a closed panel connects once and leaves a minimized panel, not a disconnect', async () => {
    useFakeClient();
    await mount(USER);
    expect(created).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    root = null;
    expect(useSupportChat.getState().panel).toBe('minimized');
    expect(closed).not.toHaveBeenCalled();
  });
});

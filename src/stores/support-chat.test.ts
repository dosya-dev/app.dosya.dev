import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/support-chat', () => ({
  fetchChatSummary: vi.fn(),
  fetchChatMessages: vi.fn(async () => []),
  postChatMessage: vi.fn(),
  postChatSeen: vi.fn(async () => undefined),
  uploadChatImages: vi.fn(),
  chatSocketUrl: () => 'wss://x/socket',
  fetchConversations: vi.fn(async () => []),
  fetchConversationMessages: vi.fn(async () => []),
  endConversation: vi.fn(),
  startConversation: vi.fn(),
  postRating: vi.fn(),
}));
vi.mock('@/lib/support-chat/sounds', () => ({
  playSend: vi.fn(), playReceive: vi.fn(),
  isMuted: vi.fn(() => false), setMuted: vi.fn(),
}));
vi.mock('@/lib/support-chat/attention', () => ({ setAttention: vi.fn(), clearAttention: vi.fn() }));

import * as rest from '@/api/support-chat';
import { ApiError } from '@/api/client';
import * as sounds from '@/lib/support-chat/sounds';
import * as attention from '@/lib/support-chat/attention';
import { __setClientFactory, useSupportChat } from './support-chat';
import type { ClientEvent } from '@/lib/support-chat/client';
import type { ClientFrame, Conversation, LiveMessage, Persona, ServerFrame } from '@/lib/support-chat/types';

class FakeClient {
  connects = 0; closes = 0; sent: ClientFrame[] = []; discarded: string[] = [];
  messages: { id: string; body: string; ids?: string[] }[] = [];
  constructor(public onEvent: (e: ClientEvent) => void) {}
  connect() { this.connects++; }
  close() { this.closes++; }
  send(f: ClientFrame) { this.sent.push(f); }
  sendMessage(body: string, ids?: string[], id = 'msg_fixed') { this.messages.push({ id, body, ids }); return id; }
  discard(id: string) { this.discarded.push(id); }
  frame(frame: ServerFrame) { this.onEvent({ type: 'frame', frame }); }
  state(state: 'online') { this.onEvent({ type: 'state', state }); }
}

let fake: FakeClient;
let created = 0;
const carl: Persona = { id: 'p1', name: 'Carl', title: 'Support', avatar_url: '/api/support/personas/p1/avatar', active: true };
const staffMsg = (id: string, persona: Persona | null = null): LiveMessage => ({
  id, chat_id: 'c1', author_type: 'staff', author_id: 's', author_name: persona?.name ?? 'Sam', kind: 'text',
  persona_id: persona?.id ?? null, body: 'hello', meta: null, attachments: [], created_at: 10, persona,
});
const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({ id, status: 'answered', persona: null, ended_by: null, ended_at: null, rating: null, started_at: 1, ...over });
const ready = (over: Partial<Extract<ServerFrame, { type: 'ready' }>> = {}): ServerFrame => ({
  v: 1, type: 'ready', chat_id: 'c1', staff_online: true, persona_online: false, conversation: conv('c1'), messages: [], unread: 0, ...over,
});

function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
  created = 0;
  localStorage.clear();
  vi.clearAllMocks();
  setVisibility('visible');
  __setClientFactory((onEvent) => { created++; fake = new FakeClient(onEvent); return fake as never; });
  useSupportChat.getState().__reset();
});
afterEach(() => { vi.useRealTimers(); __setClientFactory(null); });

describe('support chat store', () => {
  it('opens no socket on boot', () => {
    expect(created).toBe(0);
    expect(useSupportChat.getState().panel).toBe('closed');
  });

  it('closePanel disconnects; openPanel connects once', () => {
    const s = useSupportChat.getState();
    s.openPanel();
    s.minimizePanel();
    s.openPanel();
    expect(created).toBe(1);
    expect(fake.connects).toBe(1);
    useSupportChat.getState().closePanel();
    expect(fake.closes).toBe(1);
    expect(useSupportChat.getState().conn).toBe('idle');
    expect(localStorage.getItem('dosya.supportChat.panel')).toBe('closed');
    useSupportChat.getState().openPanel();
    expect(created).toBe(2);
  });

  it('a staff message while minimized reopens the panel and bumps unread when hidden', () => {
    useSupportChat.getState().openPanel();
    useSupportChat.getState().minimizePanel();
    setVisibility('hidden');
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1') });
    const st = useSupportChat.getState();
    expect(st.panel).toBe('open');
    expect(st.unread).toBe(1);
    expect(st.messages.map((m) => m.id)).toEqual(['m1']);
  });

  it('sends delivered and seen for staff messages while open and visible, and does not count them unread', () => {
    useSupportChat.getState().openPanel();
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1') });
    expect(fake.sent).toEqual([
      { v: 1, type: 'delivered', message_id: 'm1' },
      { v: 1, type: 'seen', last_message_id: 'm1' },
    ]);
    expect(useSupportChat.getState().unread).toBe(0);
  });

  it('counts unread while minimized-then-reopened is visible only after markSeen resets it', () => {
    useSupportChat.getState().openPanel();
    setVisibility('hidden');
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1') });
    expect(useSupportChat.getState().unread).toBe(1);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fake.sent.at(-1)).toEqual({ v: 1, type: 'seen', last_message_id: 'm1' });
    useSupportChat.getState().markSeen();
    expect(useSupportChat.getState().unread).toBe(0);
  });

  it('pending goes sending then sent on ack, with the pending entry present before the frame is sent', async () => {
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().send('hi', []);
    const id = fake.messages[0].id;
    expect(useSupportChat.getState().pending[id]).toBe('sending');
    fake.frame({ v: 1, type: 'ack', id, message: { ...staffMsg(id), author_type: 'user' } });
    expect(useSupportChat.getState().pending[id]).toBe('sent');
    vi.advanceTimersByTime(20_000);
    expect(useSupportChat.getState().lastFailedDraft).toBeNull();
  });

  it('uploads files first, then sends the ids', async () => {
    vi.mocked(rest.uploadChatImages).mockResolvedValue([{ id: 'att1', file_name: 'a.png', content_type: 'image/png', size_bytes: 1 }]);
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().send('pic', [new File(['x'], 'a.png')]);
    expect(fake.messages[0]).toMatchObject({ body: 'pic', ids: ['att1'] });
  });

  it('shows the message with image previews while the upload runs, then sends with the same id', async () => {
    let finish!: (a: Awaited<ReturnType<typeof rest.uploadChatImages>>) => void;
    vi.mocked(rest.uploadChatImages).mockReturnValue(new Promise((r) => { finish = r; }));
    useSupportChat.getState().openPanel();
    const done = useSupportChat.getState().send('pic', [new File(['x'], 'a.png')]);
    const row = useSupportChat.getState().messages.at(-1)!;
    expect(row).toMatchObject({ body: 'pic', author_type: 'user' });
    expect(row.previews).toEqual([{ key: expect.any(String), url: expect.any(String), name: 'a.png' }]);
    expect(useSupportChat.getState().pending[row.id]).toBe('uploading');
    expect(fake.messages).toHaveLength(0);
    // An error frame during the upload belongs to an earlier send, not this one.
    fake.frame({ v: 1, type: 'error', code: 'rate_limited', message: 'slow' });
    expect(useSupportChat.getState().pending[row.id]).toBe('uploading');
    finish([{ id: 'att1', file_name: 'a.png', content_type: 'image/png', size_bytes: 1 }]);
    await done;
    expect(fake.messages[0]).toMatchObject({ id: row.id, body: 'pic', ids: ['att1'] });
    expect(useSupportChat.getState().pending[row.id]).toBe('sending');
    const acked = { ...staffMsg(row.id), author_type: 'user' as const, attachments: [{ id: 'att1', file_name: 'a.png', content_type: 'image/png', size_bytes: 1 }] };
    fake.frame({ v: 1, type: 'ack', id: row.id, message: acked });
    // The local previews stay on the acked row so the image does not reload.
    expect(useSupportChat.getState().messages.find((m) => m.id === row.id)?.previews).toEqual(row.previews);
  });

  it('a failed upload removes the row and returns the text', async () => {
    vi.mocked(rest.uploadChatImages).mockRejectedValue(new ApiError(500, 'boom'));
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().send('pic', [new File(['x'], 'a.png')]);
    const st = useSupportChat.getState();
    expect(st.messages).toHaveLength(0);
    expect(st.pending).toEqual({});
    expect(st.lastFailedDraft).toBe('pic');
    expect(fake.messages).toHaveLength(0);
  });

  it('an upload that finishes after the thread was reset sends nothing', async () => {
    let finish!: (a: Awaited<ReturnType<typeof rest.uploadChatImages>>) => void;
    vi.mocked(rest.uploadChatImages).mockReturnValue(new Promise((r) => { finish = r; }));
    useSupportChat.getState().openPanel();
    const done = useSupportChat.getState().send('pic', [new File(['x'], 'a.png')]);
    useSupportChat.getState().closePanel();
    finish([{ id: 'att1', file_name: 'a.png', content_type: 'image/png', size_bytes: 1 }]);
    await done;
    expect(fake.messages).toHaveLength(0);
  });

  it('an ack timeout returns the text via lastFailedDraft and drops only that pending message', async () => {
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().send('one', []);
    await useSupportChat.getState().send('two', []);
    const [a, b] = Object.keys(useSupportChat.getState().pending);
    fake.frame({ v: 1, type: 'ack', id: a, message: { ...staffMsg(a), author_type: 'user' } });
    vi.advanceTimersByTime(15_000);
    const st = useSupportChat.getState();
    expect(st.lastFailedDraft).toBe('two');
    expect(st.pending[b]).toBeUndefined();
    expect(st.pending[a]).toBe('sent');
    expect(fake.discarded).toEqual([b]);
  });

  it('an error frame fails the newest sending message; not_available sets notAvailable', async () => {
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().send('x', []);
    fake.frame({ v: 1, type: 'error', code: 'rate_limited', message: 'slow' });
    expect(useSupportChat.getState().lastFailedDraft).toBe('x');
    fake.frame({ v: 1, type: 'error', code: 'not_available', message: 'plan' });
    expect(useSupportChat.getState().notAvailable).toBe(true);
  });

  it('refreshSummary updates staffOnline, unread and notAvailable; a 404 means not available', async () => {
    vi.mocked(rest.fetchChatSummary).mockResolvedValueOnce({ available: true, chat: null, conversation: null, persona_online: false, staff_online: true, unread: 3 });
    await useSupportChat.getState().refreshSummary();
    expect(useSupportChat.getState()).toMatchObject({ staffOnline: true, unread: 3, notAvailable: false });
    vi.mocked(rest.fetchChatSummary).mockRejectedValueOnce(new ApiError(404, 'nope'));
    await useSupportChat.getState().refreshSummary();
    expect(useSupportChat.getState().notAvailable).toBe(true);
  });

  it('refreshSummary with chat:null (no conversation yet) stays available, zero unread, and connects nothing', async () => {
    useSupportChat.setState({ staffSeenAt: 42, unread: 5 });
    vi.mocked(rest.fetchChatSummary).mockResolvedValueOnce({ available: true, chat: null, conversation: null, persona_online: false, staff_online: false, unread: 0 });
    await useSupportChat.getState().refreshSummary();
    expect(useSupportChat.getState()).toMatchObject({ notAvailable: false, unread: 0, staffSeenAt: 42, messages: [] });
    expect(created).toBe(0);
  });

  it('typing frames from staff set typing; presence sets staffOnline', () => {
    useSupportChat.getState().openPanel();
    fake.frame({ v: 1, type: 'typing', by: 'staff', on: true, persona_name: 'Carl' });
    fake.frame({ v: 1, type: 'presence', staff_online: true, persona_online: true, persona: carl });
    expect(useSupportChat.getState()).toMatchObject({ typing: true, typingName: 'Carl', staffOnline: true, personaOnline: true, persona: carl });
    fake.frame({ v: 1, type: 'typing', by: 'staff', on: false, persona_name: 'Carl' });
    expect(useSupportChat.getState()).toMatchObject({ typing: false, typingName: null });
  });
});

describe('support chat store: conversations, sounds and attention', () => {
  it('a staff message while the tab is hidden chimes and sets attention with count 1 and the persona name', () => {
    useSupportChat.getState().openPanel();
    setVisibility('hidden');
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1', carl) });
    expect(sounds.playReceive).toHaveBeenCalledTimes(1);
    expect(attention.setAttention).toHaveBeenCalledWith({ count: 1, personaName: 'Carl' });
    expect(useSupportChat.getState().unread).toBe(1);
  });

  it('a staff message on a visible open panel chimes but sets no attention; becoming visible clears it', () => {
    useSupportChat.getState().openPanel();
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1') });
    expect(sounds.playReceive).toHaveBeenCalledTimes(1);
    expect(attention.setAttention).not.toHaveBeenCalled();
    setVisibility('hidden');
    fake.frame({ v: 1, type: 'message', message: staffMsg('m2') });
    expect(attention.setAttention).toHaveBeenCalledWith({ count: 1, personaName: null });
    vi.mocked(attention.clearAttention).mockClear();
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(attention.clearAttention).toHaveBeenCalled();
    expect(useSupportChat.getState().unread).toBe(0);
  });

  it('the page route counts as seen: setPageVisible(true) clears attention and unread', () => {
    useSupportChat.getState().minimizePanel();
    useSupportChat.setState({ unread: 2 });
    useSupportChat.getState().setPageVisible(true);
    expect(attention.clearAttention).toHaveBeenCalled();
    expect(useSupportChat.getState().unread).toBe(0);
    setVisibility('hidden');
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1') });
    expect(useSupportChat.getState().unread).toBe(1);
    setVisibility('visible');
    fake.frame({ v: 1, type: 'message', message: staffMsg('m2') });
    expect(useSupportChat.getState().unread).toBe(1);
    useSupportChat.getState().setPageVisible(false);
  });

  it('a system message does not chime', () => {
    useSupportChat.getState().openPanel();
    fake.frame({ v: 1, type: 'message', message: { ...staffMsg('m1'), author_type: 'system', kind: 'persona_joined' } });
    expect(sounds.playReceive).not.toHaveBeenCalled();
  });

  it('muted: no receive chime and no send pop; toggleMute flips and persists', async () => {
    useSupportChat.getState().toggleMute();
    expect(sounds.setMuted).toHaveBeenCalledWith(true);
    expect(useSupportChat.getState().muted).toBe(true);
    useSupportChat.getState().openPanel();
    fake.frame({ v: 1, type: 'message', message: staffMsg('m1') });
    await useSupportChat.getState().send('hi', []);
    expect(sounds.playReceive).not.toHaveBeenCalled();
    expect(sounds.playSend).not.toHaveBeenCalled();
    useSupportChat.getState().toggleMute();
    expect(sounds.setMuted).toHaveBeenLastCalledWith(false);
    expect(useSupportChat.getState().muted).toBe(false);
  });

  it('send plays the send pop', async () => {
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().send('hi', []);
    expect(sounds.playSend).toHaveBeenCalledTimes(1);
  });

  it('ready carries the conversation, its persona and persona_online', () => {
    useSupportChat.getState().openPanel();
    fake.frame(ready({ conversation: conv('c1', { persona: carl }), persona_online: true }));
    expect(useSupportChat.getState()).toMatchObject({ conversation: { id: 'c1' }, persona: carl, personaOnline: true });
  });

  it('endConversation then startConversation: ended keeps the thread, a new conversation resets messages', () => {
    useSupportChat.getState().openPanel();
    fake.frame(ready({ conversation: conv('c1', { persona: carl }), messages: [staffMsg('m1')] }));
    useSupportChat.getState().endConversation();
    expect(fake.sent.at(-1)).toEqual({ v: 1, type: 'end' });
    fake.frame({ v: 1, type: 'conversation', conversation: conv('c1', { persona: carl, status: 'ended', ended_by: 'user', ended_at: 5 }) });
    expect(useSupportChat.getState().conversation?.status).toBe('ended');
    expect(useSupportChat.getState().messages.map((m) => m.id)).toEqual(['m1']);
    useSupportChat.getState().startConversation();
    expect(fake.sent.at(-1)).toEqual({ v: 1, type: 'start' });
    fake.frame({ v: 1, type: 'conversation', conversation: conv('c2') });
    expect(useSupportChat.getState().conversation?.id).toBe('c2');
    expect(useSupportChat.getState().messages).toEqual([]);
    expect(useSupportChat.getState().persona).toBeNull();
  });

  it('a ready for a different conversation replaces the thread instead of merging', () => {
    useSupportChat.getState().openPanel();
    fake.frame(ready({ messages: [staffMsg('m1')] }));
    fake.frame(ready({ conversation: conv('c2'), messages: [staffMsg('m9')] }));
    expect(useSupportChat.getState().messages.map((m) => m.id)).toEqual(['m9']);
  });

  it('viewConversation(id) loads that history over REST without touching the socket; null returns to active', async () => {
    vi.mocked(rest.fetchConversationMessages).mockResolvedValueOnce([staffMsg('h1')]);
    await useSupportChat.getState().viewConversation('old1');
    expect(rest.fetchConversationMessages).toHaveBeenCalledWith('old1');
    expect(created).toBe(0);
    expect(useSupportChat.getState().viewing).toBe('old1');
    expect(useSupportChat.getState().historyMessages.map((m) => m.id)).toEqual(['h1']);
    await useSupportChat.getState().viewConversation(null);
    expect(useSupportChat.getState()).toMatchObject({ viewing: null, historyMessages: [] });
    expect(created).toBe(0);
  });

  it('loadHistory fills history from REST without a socket', async () => {
    const item = { ...conv('old1', { status: 'ended' }), title: 'Hi', last_message_at: 3 };
    vi.mocked(rest.fetchConversations).mockResolvedValueOnce([item]);
    await useSupportChat.getState().loadHistory();
    expect(useSupportChat.getState().history).toEqual([item]);
    expect(created).toBe(0);
  });

  it('rate on the active conversation sends a rate frame; on a viewed one posts over REST with its id', async () => {
    useSupportChat.getState().openPanel();
    await useSupportChat.getState().rate(5, true, 'great');
    expect(fake.sent.at(-1)).toEqual({ v: 1, type: 'rate', stars: 5, solved: true, comment: 'great' });
    const item = { ...conv('old1', { status: 'ended' }), title: 'Hi', last_message_at: 3 };
    useSupportChat.setState({ history: [item] });
    await useSupportChat.getState().viewConversation('old1');
    const rating = { stars: 4, solved: false, comment: null, created_at: 9 };
    vi.mocked(rest.postRating).mockResolvedValueOnce(rating);
    const sentBefore = fake.sent.length;
    await useSupportChat.getState().rate(4, false, '');
    expect(rest.postRating).toHaveBeenCalledWith({ stars: 4, solved: false, conversation_id: 'old1' });
    expect(useSupportChat.getState().history[0].rating).toEqual(rating);
    expect(fake.sent).toHaveLength(sentBefore);
  });

  it('a REST rating refusal surfaces as lastError', async () => {
    await useSupportChat.getState().viewConversation('old1');
    vi.mocked(rest.postRating).mockRejectedValueOnce(new ApiError(409, JSON.stringify({ ok: false, error: 'rating_closed' })));
    await useSupportChat.getState().rate(4, false, '');
    expect(useSupportChat.getState().lastError).toBe('rating_closed');
  });

  it('opening another past conversation (or going back) clears a stale rating_closed', async () => {
    useSupportChat.setState({ lastError: 'rating_closed' });
    await useSupportChat.getState().viewConversation('old2');
    expect(useSupportChat.getState().lastError).toBeNull();
    useSupportChat.setState({ lastError: 'rating_closed' });
    await useSupportChat.getState().viewConversation(null);
    expect(useSupportChat.getState().lastError).toBeNull();
  });

  it('a conversation_empty error frame sets lastError and never fails a pending message', async () => {
    useSupportChat.getState().openPanel();
    fake.frame(ready({ messages: [] }));
    useSupportChat.setState({ pending: { m_p: 'sending' } });
    fake.frame({ v: 1, type: 'error', code: 'conversation_empty', message: 'x' });
    expect(useSupportChat.getState().lastError).toBe('conversation_empty');
    expect(useSupportChat.getState().pending).toEqual({ m_p: 'sending' });
  });

  it('error conversation_ended refreshes the summary and fails the pending send; other conversation codes set lastError', async () => {
    vi.mocked(rest.fetchChatSummary).mockResolvedValue({ available: true, chat: null, conversation: conv('c1', { status: 'ended' }), persona_online: false, staff_online: true, unread: 0 });
    useSupportChat.getState().openPanel();
    fake.frame(ready());
    await useSupportChat.getState().send('late', []);
    fake.frame({ v: 1, type: 'error', code: 'conversation_ended', message: 'ended' });
    expect(rest.fetchChatSummary).toHaveBeenCalled();
    expect(useSupportChat.getState().lastFailedDraft).toBe('late');
    await vi.waitFor(() => expect(useSupportChat.getState().conversation?.status).toBe('ended'));
    useSupportChat.setState({ lastFailedDraft: null });
    await useSupportChat.getState().send('next', []);
    fake.frame({ v: 1, type: 'error', code: 'too_many_conversations', message: 'x' });
    expect(useSupportChat.getState().lastError).toBe('too_many_conversations');
    expect(useSupportChat.getState().lastFailedDraft).toBeNull(); // not a message refusal
    useSupportChat.getState().clearError();
    expect(useSupportChat.getState().lastError).toBeNull();
  });

  it('refreshSummary carries conversation and persona_online', async () => {
    vi.mocked(rest.fetchChatSummary).mockResolvedValueOnce({ available: true, chat: null, conversation: conv('c1', { persona: carl }), persona_online: true, staff_online: true, unread: 0 });
    await useSupportChat.getState().refreshSummary();
    expect(useSupportChat.getState()).toMatchObject({ conversation: { id: 'c1' }, persona: carl, personaOnline: true });
  });

  it('__reset clears attention', () => {
    useSupportChat.getState().__reset();
    expect(attention.clearAttention).toHaveBeenCalled();
  });
});

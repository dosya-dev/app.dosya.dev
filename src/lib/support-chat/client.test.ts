import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportChatClient, type ClientEvent, type ConnState } from './client';
import type { ChatMessage, ClientFrame, Conversation, Persona, ServerFrame } from './types';

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: ClientFrame[] = [];
  closed = false;
  constructor(public url: string) { FakeWS.instances.push(this); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  recv(f: ServerFrame) { this.onmessage?.({ data: JSON.stringify(f) }); }
  drop(code = 1006, reason = '') { this.onclose?.({ code, reason }); }
}

function msg(id: string, created_at: number, author: 'user' | 'staff' = 'staff', persona_id: string | null = null): ChatMessage {
  return { id, chat_id: 'c1', author_type: author, author_id: null, author_name: null, kind: 'text', persona_id, body: id, meta: null, attachments: [], created_at };
}
const carl: Persona = { id: 'p1', name: 'Carl', title: null, avatar_url: null, active: true };
const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({ id, status: 'answered', persona: null, ended_by: null, ended_at: null, rating: null, started_at: 1, ...over });
const ready = (messages: ChatMessage[] = [], conversation: Conversation = conv('c1')): ServerFrame => ({
  v: 1, type: 'ready', chat_id: conversation.id, staff_online: false, persona_online: false, conversation,
  messages: messages.map((m) => ({ ...m, persona: null })), unread: 0,
});

function setup(over: Partial<ConstructorParameters<typeof SupportChatClient>[0]> = {}) {
  const events: ClientEvent[] = [];
  const rest = {
    fetchMessages: vi.fn(async (_a?: number) => [] as ChatMessage[]),
    postMessage: vi.fn(async (i: { id: string; body: string }) => msg(i.id, 100, 'user')),
    postSeen: vi.fn(async () => undefined),
    endConversation: vi.fn(async () => conv('c1', { status: 'ended', ended_by: 'user', ended_at: 5 })),
    startConversation: vi.fn(async () => conv('c2')),
    postRating: vi.fn(async (r: { stars: number; solved: boolean; comment?: string }) => ({ stars: r.stars, solved: r.solved, comment: r.comment ?? null, created_at: 9 })),
  };
  const client = new SupportChatClient({
    socketUrl: () => 'wss://x/api/support/chat/socket',
    WebSocket: FakeWS as unknown as typeof WebSocket,
    rest,
    onEvent: (e) => events.push(e),
    diagnostics: () => undefined,
    ...over,
  });
  const states = () => events.filter((e): e is Extract<ClientEvent, { type: 'state' }> => e.type === 'state').map((e) => e.state);
  const frames = () => events.filter((e): e is Extract<ClientEvent, { type: 'frame' }> => e.type === 'frame').map((e) => e.frame);
  return { client, events, rest, states, frames };
}

const last = () => FakeWS.instances[FakeWS.instances.length - 1];

beforeEach(() => { vi.useFakeTimers(); FakeWS.instances = []; });
afterEach(() => { vi.useRealTimers(); });

describe('SupportChatClient', () => {
  it('queues frames until online and flushes them in order', () => {
    const { client, states } = setup();
    client.connect();
    client.send({ v: 1, type: 'typing', on: true });
    client.send({ v: 1, type: 'seen', last_message_id: 'a' });
    const id = client.sendMessage('hi');
    expect(last().sent).toEqual([]);
    last().open();
    expect(states()).toEqual(['connecting', 'online']);
    const types = last().sent.map((f) => f.type);
    expect(types[0]).toBe('hello');
    expect(types.slice(1)).toEqual(['seen', 'message']);
    expect(last().sent[2]).toMatchObject({ type: 'message', id, body: 'hi' });
  });

  it('backs off 1,2 s and switches to polling after three failures in 30 s; a later socket returns to online', async () => {
    const { client, states } = setup();
    client.connect();
    expect(FakeWS.instances).toHaveLength(1);
    last().drop();
    expect(states().at(-1)).toBe('reconnecting');
    vi.advanceTimersByTime(999);
    expect(FakeWS.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(2);
    last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeWS.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(3);
    last().drop();
    expect(states().at(-1)).toBe('polling');
    // the socket is retried every 60 s while polling
    vi.advanceTimersByTime(60_000);
    expect(FakeWS.instances).toHaveLength(4);
    expect(states().at(-1)).toBe('polling');
    last().open();
    expect(states().at(-1)).toBe('online');
  });

  it('caps the backoff at 30 s and resets to 1 s only after 10 s open', () => {
    const { client } = setup();
    client.connect();
    // a connection that opens and is dropped at once does not reset the backoff
    last().open(); last().drop();            // wait 1
    vi.advanceTimersByTime(1000);
    last().open(); vi.advanceTimersByTime(10_000); last().drop(); // stayed 10 s: reset, wait 1
    const n = FakeWS.instances.length;
    vi.advanceTimersByTime(999);
    expect(FakeWS.instances).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeWS.instances).toHaveLength(n + 1);
  });

  it('sendMessage returns a msg_ id and resends the same id after a reconnect (no new id)', () => {
    const { client } = setup();
    client.connect();
    last().open();
    const first = last();
    const id = client.sendMessage('hello');
    expect(id).toMatch(/^msg_/);
    first.drop();            // the ack never came
    vi.advanceTimersByTime(1000);
    last().open();
    const resent = last().sent.filter((f) => f.type === 'message');
    expect(resent).toHaveLength(1);
    expect(resent[0]).toMatchObject({ id, body: 'hello' });
  });

  it('close code 4403 ends in closed and emits error not_available without reconnecting', () => {
    const { client, states, frames } = setup();
    client.connect();
    last().open();
    last().drop(4403, 'not_available');
    expect(states().at(-1)).toBe('closed');
    expect(frames().at(-1)).toMatchObject({ type: 'error', code: 'not_available' });
    vi.advanceTimersByTime(120_000);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('policy closes 4000-4099 stop reconnecting and surface bad_frame with the reason', () => {
    const { client, states, frames } = setup();
    client.connect();
    last().open();
    last().drop(4000, 'too_many_sockets');
    expect(states().at(-1)).toBe('closed');
    expect(frames().at(-1)).toMatchObject({ type: 'error', code: 'bad_frame', message: 'too_many_sockets' });
    vi.advanceTimersByTime(120_000);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('goes straight to polling when the WebSocket constructor throws, and posts over REST', async () => {
    class Throwing { constructor() { throw new Error('blocked'); } }
    const { client, states, rest, frames } = setup({ WebSocket: Throwing as unknown as typeof WebSocket });
    client.connect();
    expect(states().at(-1)).toBe('polling');
    const id = client.sendMessage('over rest');
    expect(rest.postMessage).toHaveBeenCalledWith({ id, body: 'over rest' });
    await vi.advanceTimersByTimeAsync(0);
    expect(frames().find((f) => f.type === 'ack')).toMatchObject({ type: 'ack', id });
  });

  it('polls every 10 s with after = last created_at and emits new staff messages once', async () => {
    const { client, rest, frames } = setup();
    client.connect();
    last().open();
    last().recv(ready([msg('m1', 50)]));
    for (let i = 0; i < 3; i++) { last().drop(); vi.advanceTimersByTime(5000); }
    rest.fetchMessages.mockResolvedValueOnce([msg('m2', 60)]).mockResolvedValue([msg('m2', 60)]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rest.fetchMessages).toHaveBeenCalledWith(49);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(frames().filter((f) => f.type === 'message' && f.message.id === 'm2')).toHaveLength(1);
  });

  it('a constructor that throws on every retry keeps exactly one poll chain and one retry chain', async () => {
    class Throwing { static n = 0; constructor() { Throwing.n++; throw new Error('blocked'); } }
    const { client, rest, states } = setup({ WebSocket: Throwing as unknown as typeof WebSocket });
    client.connect();
    expect(states().at(-1)).toBe('polling');
    await vi.advanceTimersByTimeAsync(300_000); // five retries
    expect(Throwing.n).toBe(1 + 5);
    expect(rest.fetchMessages).toHaveBeenCalledTimes(30);
    expect(states().filter((s) => s === 'polling')).toHaveLength(1);
  });

  it('close() while polling stops every timer', async () => {
    class Throwing { constructor() { throw new Error('blocked'); } }
    const { client, rest } = setup({ WebSocket: Throwing as unknown as typeof WebSocket });
    client.connect();
    await vi.advanceTimersByTimeAsync(70_000);
    client.close();
    const calls = rest.fetchMessages.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(rest.fetchMessages.mock.calls.length).toBe(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards the new server frames unchanged', () => {
    const { client, frames } = setup();
    client.connect();
    last().open();
    const sent: ServerFrame[] = [
      ready([], conv('c1', { persona: carl })),
      { v: 1, type: 'conversation', conversation: conv('c1', { status: 'ended' }) },
      { v: 1, type: 'presence', staff_online: true, persona_online: true, persona: carl },
      { v: 1, type: 'typing', by: 'staff', on: true, persona_name: 'Carl' },
      { v: 1, type: 'error', code: 'too_many_conversations', message: 'x' },
    ];
    for (const f of sent) last().recv(f);
    expect(frames()).toEqual(sent);
  });

  it('queues end, start and rate until online, then sends them on the socket', () => {
    const { client } = setup();
    client.connect();
    client.send({ v: 1, type: 'end' });
    client.send({ v: 1, type: 'start' });
    client.send({ v: 1, type: 'rate', stars: 5, solved: true });
    last().open();
    expect(last().sent.map((f) => f.type)).toEqual(['hello', 'end', 'start', 'rate']);
  });

  it('while polling, end/start/rate go over REST and emit a synthetic conversation frame', async () => {
    const { client, rest, frames } = setup();
    client.connect();
    last().open();
    last().recv(ready([], conv('c1', { persona: carl })));
    for (let i = 0; i < 3; i++) { last().drop(); vi.advanceTimersByTime(5000); }
    client.send({ v: 1, type: 'end' });
    await vi.advanceTimersByTimeAsync(0);
    expect(rest.endConversation).toHaveBeenCalled();
    expect(frames().at(-1)).toEqual({ v: 1, type: 'conversation', conversation: conv('c1', { status: 'ended', ended_by: 'user', ended_at: 5 }) });
    client.send({ v: 1, type: 'rate', stars: 4, solved: false, comment: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    expect(rest.postRating).toHaveBeenCalledWith({ stars: 4, solved: false, comment: 'ok' });
    expect(frames().at(-1)).toMatchObject({ type: 'conversation', conversation: { id: 'c1', status: 'ended', rating: { stars: 4, solved: false, comment: 'ok' } } });
    client.send({ v: 1, type: 'start' });
    await vi.advanceTimersByTimeAsync(0);
    expect(frames().at(-1)).toEqual({ v: 1, type: 'conversation', conversation: conv('c2') });
  });

  it('a REST refusal while polling surfaces the server code as an error frame', async () => {
    class Throwing { constructor() { throw new Error('blocked'); } }
    const { client, rest, frames } = setup({ WebSocket: Throwing as unknown as typeof WebSocket });
    rest.startConversation.mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429, body: JSON.stringify({ ok: false, error: 'too_many_conversations' }) }));
    rest.postMessage.mockRejectedValueOnce(Object.assign(new Error('409'), { status: 409, body: JSON.stringify({ ok: false, error: 'conversation_ended' }) }));
    rest.postMessage.mockRejectedValueOnce(new Error('offline'));
    client.connect();
    client.send({ v: 1, type: 'start' });
    client.sendMessage('late');
    client.sendMessage('later');
    await vi.advanceTimersByTimeAsync(0);
    const errors = frames().filter((f) => f.type === 'error').map((f) => f.type === 'error' && [f.code, f.message]);
    expect(errors).toEqual([
      ['too_many_conversations', 'too_many_conversations'],
      ['conversation_ended', 'send_failed'],
      ['bad_frame', 'send_failed'],
    ]);
  });

  it('polled staff messages carry the conversation persona when the ids match', async () => {
    const { client, rest, frames } = setup();
    client.connect();
    last().open();
    last().recv(ready([], conv('c1', { persona: carl })));
    for (let i = 0; i < 3; i++) { last().drop(); vi.advanceTimersByTime(5000); }
    rest.fetchMessages.mockResolvedValue([msg('m2', 60, 'staff', 'p1'), msg('m3', 61, 'staff', 'p9')]);
    await vi.advanceTimersByTimeAsync(10_000);
    const polled = frames().filter((f) => f.type === 'message').map((f) => f.type === 'message' && f.message.persona);
    expect(polled).toEqual([carl, null]);
  });

  it('close() clears timers and stops reconnecting', () => {
    const { client, states } = setup();
    client.connect();
    last().drop();
    client.close();
    vi.advanceTimersByTime(120_000);
    expect(FakeWS.instances).toHaveLength(1);
    expect(states().at(-1) as ConnState).toBe('idle');
  });
});

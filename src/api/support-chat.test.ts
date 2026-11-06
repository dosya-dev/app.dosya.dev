import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('./client', () => ({ api: (...a: unknown[]) => api(...a), API_BASE: '', ApiError: class extends Error {} }));

const {
  fetchChatMessages, fetchChatSummary, fetchConversations, fetchConversationMessages, endConversation, startConversation, postRating,
} = await import('./support-chat');

beforeEach(() => api.mockReset());

const conversation = { id: 'c1', status: 'ended', persona: null, ended_by: 'user', ended_at: 5, rating: null, started_at: 1 };

describe('support chat api', () => {
  it('fetchChatSummary passes chat:null through for a user with no conversation yet', async () => {
    api.mockResolvedValue({ ok: true, available: true, chat: null, staff_online: true, unread: 0 });
    expect(await fetchChatSummary()).toEqual({ available: true, chat: null, conversation: null, persona_online: false, staff_online: true, unread: 0 });
    expect(api).toHaveBeenCalledWith('/api/support/chat');
  });

  it('fetchChatSummary carries the conversation and persona_online', async () => {
    api.mockResolvedValue({ ok: true, available: true, chat: { id: 'c1' }, conversation, persona_online: true, staff_online: true, unread: 0 });
    expect(await fetchChatSummary()).toMatchObject({ conversation, persona_online: true });
  });

  it('fetchConversations returns the history list', async () => {
    api.mockResolvedValue({ ok: true, conversations: [{ ...conversation, title: 'Hi', last_message_at: 4 }] });
    expect(await fetchConversations()).toEqual([{ ...conversation, title: 'Hi', last_message_at: 4 }]);
    expect(api).toHaveBeenCalledWith('/api/support/chat/conversations');
  });

  it('fetchConversationMessages asks for one conversation by id', async () => {
    api.mockResolvedValue({ ok: true, messages: [] });
    await fetchConversationMessages('c 1');
    expect(api).toHaveBeenCalledWith('/api/support/chat/messages?conversation=c%201');
  });

  it('end and start POST and return the conversation', async () => {
    api.mockResolvedValue({ ok: true, conversation });
    expect(await endConversation()).toEqual(conversation);
    expect(api).toHaveBeenLastCalledWith('/api/support/chat/end', { method: 'POST' });
    expect(await startConversation()).toEqual(conversation);
    expect(api).toHaveBeenLastCalledWith('/api/support/chat/start', { method: 'POST' });
  });

  it('postRating sends stars, solved, an optional comment and conversation id, and returns the rating', async () => {
    const rating = { stars: 5, solved: true, comment: 'thanks', created_at: 9 };
    api.mockResolvedValue({ ok: true, rating });
    expect(await postRating({ stars: 5, solved: true, comment: 'thanks', conversation_id: 'c1' })).toEqual(rating);
    expect(api).toHaveBeenLastCalledWith('/api/support/chat/rating', {
      method: 'POST', body: JSON.stringify({ stars: 5, solved: true, comment: 'thanks', conversation_id: 'c1' }),
    });
  });

  it('fetchChatSummary reports available:false for a lapsed plan with history', async () => {
    const chat = { id: 'c1' };
    api.mockResolvedValue({ ok: true, available: false, chat, staff_online: false, unread: 1 });
    expect(await fetchChatSummary()).toMatchObject({ available: false, chat });
  });

  it('fetchChatMessages returns an empty list when there is no chat', async () => {
    api.mockResolvedValue({ ok: true, messages: [] });
    expect(await fetchChatMessages()).toEqual([]);
  });
});

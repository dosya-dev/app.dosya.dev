import { api, API_BASE, ApiError } from './client';
import type { ChatAttachment, ChatMessage, ChatSummary, Conversation, Rating } from '@/lib/support-chat/types';

export interface ChatSummaryResult {
  available: boolean;
  chat: ChatSummary | null;
  /** The active conversation (null before the first one, or when the room could not be asked). */
  conversation: Conversation | null;
  persona_online: boolean;
  staff_online: boolean;
  unread: number;
}

export function fetchChatSummary(): Promise<ChatSummaryResult> {
  return api<{
    ok: boolean; available?: boolean; chat: ChatSummary | null; conversation?: Conversation | null;
    persona_online?: boolean; staff_online: boolean; unread: number;
  }>('/api/support/chat').then((r) => ({
    available: r.available !== false,
    chat: r.chat,
    conversation: r.conversation ?? null,
    persona_online: !!r.persona_online,
    staff_online: !!r.staff_online,
    unread: r.unread ?? 0,
  }));
}

export function fetchChatMessages(after?: number): Promise<ChatMessage[]> {
  const q = after ? `?after=${after}` : '';
  return api<{ ok: boolean; messages: ChatMessage[] }>(`/api/support/chat/messages${q}`).then((r) => r.messages);
}

export function postChatMessage(input: { id: string; body: string; attachment_ids?: string[] }): Promise<ChatMessage> {
  return api<{ ok: boolean; message: ChatMessage }>('/api/support/chat/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.message);
}

export function postChatSeen(): Promise<void> {
  return api('/api/support/chat/seen', { method: 'POST' }).then(() => undefined);
}

/** A past or current conversation as the history list shows it. */
export type ConversationListItem = Conversation & { title: string | null; last_message_at: number };

export function fetchConversations(): Promise<ConversationListItem[]> {
  return api<{ ok: boolean; conversations: ConversationListItem[] }>('/api/support/chat/conversations').then((r) => r.conversations);
}

/** One conversation's messages, read-only (the caller's own only). */
export function fetchConversationMessages(id: string): Promise<ChatMessage[]> {
  return api<{ ok: boolean; messages: ChatMessage[] }>(`/api/support/chat/messages?conversation=${encodeURIComponent(id)}`)
    .then((r) => r.messages);
}

export function endConversation(): Promise<Conversation> {
  return api<{ ok: boolean; conversation: Conversation }>('/api/support/chat/end', { method: 'POST' }).then((r) => r.conversation);
}

export function startConversation(): Promise<Conversation> {
  return api<{ ok: boolean; conversation: Conversation }>('/api/support/chat/start', { method: 'POST' }).then((r) => r.conversation);
}

/** Rates the active conversation, or `conversation_id` when given. 409 `not_ended` / `rating_closed` arrive as ApiError. */
export function postRating(input: { stars: number; solved: boolean; comment?: string; conversation_id?: string }): Promise<Rating> {
  return api<{ ok: boolean; rating: Rating }>('/api/support/chat/rating', {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((r) => r.rating);
}

// Multipart bypasses api(): its forced Content-Type: application/json would break the boundary.
export async function uploadChatImages(files: File[]): Promise<ChatAttachment[]> {
  const fd = new FormData();
  for (const f of files) fd.append('images', f);
  const res = await fetch(`${API_BASE}/api/support/chat/attachments`, { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  const json = (await res.json()) as { ok: boolean; attachments: ChatAttachment[] };
  return json.attachments;
}

export function chatAttachmentUrl(id: string): string {
  return `${API_BASE}/api/support/chat/attachments/${id}`;
}

export function chatSocketUrl(): string {
  const base = API_BASE ? API_BASE.replace(/^http/, 'ws') : location.origin.replace(/^http/, 'ws');
  return `${base}/api/support/chat/socket`;
}

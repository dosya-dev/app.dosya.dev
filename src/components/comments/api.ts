import { api } from '@/api/client';
import type { Comment, DraftAnchor, MentionCandidate } from './types';

export async function listComments(fileId: string, workspaceId: string): Promise<Comment[]> {
  const d = await api<{ ok: boolean; comments: Comment[] }>(`/api/comments?file_id=${encodeURIComponent(fileId)}&workspace_id=${encodeURIComponent(workspaceId)}`);
  return d.comments ?? [];
}

export async function postComment(input: {
  workspaceId: string; fileId: string; body: string; parentId?: string | null;
  anchor?: DraftAnchor; anchorVersion?: number | null; mentionIds?: string[];
}): Promise<Comment> {
  const a = input.anchor ?? null;
  const d = await api<{ ok: boolean; comment: Comment }>('/api/comments', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: input.workspaceId,
      file_id: input.fileId,
      body: input.body,
      parent_id: input.parentId ?? undefined,
      anchor_ms: a?.kind === 'time' ? a.ms : undefined,
      anchor_page: a?.kind === 'page' ? a.page : undefined,
      anchor_version: a ? input.anchorVersion ?? undefined : undefined,
      mention_user_ids: input.mentionIds?.length ? input.mentionIds : undefined,
    }),
  });
  return d.comment;
}

export async function editComment(id: string, body: string, mentionIds?: string[]): Promise<void> {
  await api(`/api/comments/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ body, mention_user_ids: mentionIds }),
  });
}

export async function deleteComment(id: string): Promise<void> {
  await api(`/api/comments/${id}`, { method: 'DELETE' });
}

export async function searchMentionable(workspaceId: string, fileId: string, q: string): Promise<MentionCandidate[]> {
  const d = await api<{ ok: boolean; users: MentionCandidate[] }>(
    `/api/comments/mentionable?workspace_id=${encodeURIComponent(workspaceId)}&file_id=${encodeURIComponent(fileId)}&q=${encodeURIComponent(q)}`,
  );
  return d.users ?? [];
}

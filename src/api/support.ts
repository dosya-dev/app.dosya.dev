import { api, API_BASE, ApiError } from './client';

export type TicketStatus = 'open' | 'answered' | 'closed';
export type TicketCategory = 'billing' | 'technical' | 'account' | 'feature_request' | 'other';

export interface TicketSummary {
  id: string;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: number;
  last_message_at: number;
  message_count: number;
}

export interface TicketAttachment {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  url: string;
}

export interface TicketMessage {
  id: string;
  author_type: 'user' | 'staff';
  author_name: string | null;
  body: string;
  created_at: number;
  attachments: TicketAttachment[];
}

export interface TicketDetail {
  id: string;
  workspace_id: string | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  created_at: number;
  updated_at: number;
  last_message_at: number;
  closed_at: number | null;
  closed_by: 'user' | 'staff' | null;
}

export function fetchTickets(status?: 'open' | 'closed') {
  const q = status ? `?status=${status}` : '';
  return api<{ ok: boolean; tickets: TicketSummary[]; counts: { open: number; closed: number } }>(
    `/api/support/tickets${q}`,
  ).then((r) => ({ tickets: r.tickets, counts: r.counts }));
}

export function fetchTicket(id: string) {
  return api<{ ok: boolean; ticket: TicketDetail; messages: TicketMessage[] }>(
    `/api/support/tickets/${id}`,
  ).then((r) => ({
    ticket: r.ticket,
    // Attachment URLs come back as API-relative paths; point them at the API
    // origin (empty in dev, where the Vite proxy handles /api).
    messages: r.messages.map((m) => ({
      ...m,
      attachments: m.attachments.map((a) => ({ ...a, url: `${API_BASE}${a.url}` })),
    })),
  }));
}

// Multipart posts bypass api() — its forced Content-Type: application/json would break the boundary.
async function postMultipart<T>(path: string, fd: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  return res.json();
}

export function createTicket(fields: {
  subject: string;
  category: TicketCategory;
  body: string;
  workspaceId?: string;
  images: File[];
}) {
  const fd = new FormData();
  fd.append('subject', fields.subject);
  fd.append('category', fields.category);
  fd.append('body', fields.body);
  if (fields.workspaceId) fd.append('workspace_id', fields.workspaceId);
  for (const f of fields.images) fd.append('images', f);
  return postMultipart<{ ok: boolean; ticket: TicketSummary }>('/api/support/tickets', fd);
}

export function replyTicket(id: string, body: string, images: File[]) {
  const fd = new FormData();
  fd.append('body', body);
  for (const f of images) fd.append('images', f);
  return postMultipart<{ ok: boolean; message: { id: string; created_at: number } }>(
    `/api/support/tickets/${id}/reply`, fd,
  );
}

export function closeTicket(id: string) {
  return api(`/api/support/tickets/${id}/close`, { method: 'POST' }).then(() => undefined);
}

import type { Comment } from './types';

/** Link into the viewer's Comments tab at a comment's anchor. */
export function viewerHref(fileId: string, c: Pick<Comment, 'id' | 'anchor_ms' | 'anchor_page'>): string {
  const q = new URLSearchParams({ view: fileId, tab: 'comments', comment: c.id });
  if (c.anchor_ms != null) q.set('t', String(c.anchor_ms));
  else if (c.anchor_page != null) q.set('p', String(c.anchor_page));
  return `/files?${q.toString()}`;
}

const posInt = (v: string | null, min: number): number | null => {
  if (v === null || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min ? n : null;
};

/** Junk values (negative, zero page, non-numeric) are ignored, never thrown on. */
export function readViewerIntent(params: URLSearchParams): {
  tab: 'comments' | null; anchor: { ms: number } | { page: number } | null; commentId: string | null;
} {
  const ms = posInt(params.get('t'), 0);
  const page = posInt(params.get('p'), 1);
  return {
    tab: params.get('tab') === 'comments' ? 'comments' as const : null,
    anchor: ms !== null ? { ms } : page !== null ? { page } : null,
    commentId: params.get('comment') || null,
  };
}

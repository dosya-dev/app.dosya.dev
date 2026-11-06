import { t } from '@/lib/i18n';
import type { Comment, CommentMention } from './types';

export function formatMs(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function anchorLabel(c: Pick<Comment, 'anchor_ms' | 'anchor_page'>): string | null {
  if (c.anchor_ms != null) return formatMs(c.anchor_ms);
  if (c.anchor_page != null) return `p. ${c.anchor_page}`;
  return null;
}

/** Was this comment left on an earlier version than the one now current? */
export function isOlderVersion(c: Pick<Comment, 'anchor_version'>, currentVersion: number | null): boolean {
  return currentVersion != null && c.anchor_version != null && c.anchor_version < currentVersion;
}

/**
 * What to tell someone who just jumped to an anchor left on an older version
 * (spec 6.3), or null. One sentence for every way in: the panel chip and the
 * waveform / video / page markers all select through the viewer's
 * onSelectComment, which is the one caller.
 */
export function olderVersionNote(c: Pick<Comment, 'anchor_version'>, currentVersion: number | null): string | null {
  return isOlderVersion(c, currentVersion) ? t('common.label.commentWasLeftOnVCanchorVersion', { cAnchor_version: c.anchor_version ?? '' }) : null;
}

/** The ids whose `@Name` is still in the text: deleting the text unmentions. */
export function activeMentionIds(body: string, picked: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  for (const [id, name] of picked) if (body.includes(`@${name}`)) out.push(id);
  return out;
}

export type BodySegment = { text: string; mention: boolean };

/** Plain text in, segments out. Never HTML: bodies are rendered as text nodes. */
export function splitMentions(body: string, mentions: CommentMention[]): BodySegment[] {
  const names = [...new Set(mentions.map((m) => m.name))].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: body, mention: false }];
  const out: BodySegment[] = [];
  let plain = '';
  let i = 0;
  while (i < body.length) {
    const hit = body[i] === '@' ? names.find((n) => body.startsWith(n, i + 1)) : undefined;
    if (hit) {
      if (plain) { out.push({ text: plain, mention: false }); plain = ''; }
      out.push({ text: `@${hit}`, mention: true });
      i += hit.length + 1;
    } else {
      plain += body[i];
      i += 1;
    }
  }
  if (plain) out.push({ text: plain, mention: false });
  return out;
}

/** An `@query` the caret is inside of: `@` at the start or after whitespace,
 *  no whitespace since. `me@x` is an email, not a mention. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

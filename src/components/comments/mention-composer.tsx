import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Send, X, AtSign } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { LIMITS } from '@/lib/validation-policy.generated';
import { searchMentionable } from './api';
import { activeMentionIds, formatMs, mentionQueryAt } from './format';
import type { CommentMention, DraftAnchor, MentionCandidate } from './types';

export interface MentionComposerProps {
  workspaceId: string;
  fileId: string;
  placeholder?: string;
  autoFocus?: boolean;
  initialBody?: string;
  initialMentions?: CommentMention[];
  anchor?: DraftAnchor;
  onClearAnchor?(): void;
  onFocus?(): void;
  submitLabel?: string;
  onSubmit(body: string, mentionIds: string[]): Promise<boolean>;
  onCancel?(): void;
  /** Handed the textarea so a caller can focus it (Reply on the comments page). */
  inputRef?: MutableRefObject<HTMLTextAreaElement | null>;
}

/**
 * Show the character counter only once the body is within 10% of the cap.
 * A counter that is always visible on a one-line comment is noise; a cap you
 * only learn about from a rejected 6000-character paste is worse.
 */
const COMMENT_COUNTER_FROM = Math.floor(LIMITS.COMMENT_BODY_MAX * 0.9);

/** Enter that confirms an IME candidate (Japanese, Chinese, Korean...) is not a send. */
const isComposing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;

type Picker = { start: number; query: string; items: MentionCandidate[]; active: number; failed: boolean } | null;

export function MentionComposer({
  workspaceId, fileId, placeholder = 'Write a comment… Use @ to mention', autoFocus,
  initialBody = '', initialMentions = [], anchor = null, onClearAnchor, onFocus,
  submitLabel = 'Send', onSubmit, onCancel, inputRef,
}: MentionComposerProps) {
  const [body, setBody] = useState(initialBody);
  const [picked, setPicked] = useState<Map<string, string>>(() => new Map(initialMentions.map((m) => [m.id, m.name])));
  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const debounce = useRef<number | null>(null);
  const overLimit = body.trim().length > LIMITS.COMMENT_BODY_MAX;

  useEffect(() => () => { if (debounce.current) window.clearTimeout(debounce.current); }, []);

  // Debounced lookup. An answer is applied only while the picker still shows
  // the same "@" position AND the same query: a slow answer for "@ay" landing
  // after the person typed "@al" would otherwise let Enter mention Ayşe.
  const lookup = (start: number, query: string) => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const current = (p: Picker): p is NonNullable<Picker> => !!p && p.start === start && p.query === query;
      searchMentionable(workspaceId, fileId, query).then(
        (items) => setPicker((p) => (current(p) ? { ...p, items, active: 0, failed: false } : p)),
        () => setPicker((p) => (current(p) ? { ...p, items: [], failed: true } : p)),
      );
    }, 150);
  };

  const onChange = (value: string) => {
    setBody(value);
    const caret = ref.current?.selectionStart ?? value.length;
    const hit = mentionQueryAt(value, caret);
    if (!hit) { setPicker(null); return; }
    // A changed query clears the list: rows matched for the old text are not
    // candidates for the new text, and Enter must not pick one of them.
    setPicker((p) => ({
      start: hit.start, query: hit.query,
      items: p?.start === hit.start && p.query === hit.query ? p.items : [],
      active: 0, failed: false,
    }));
    lookup(hit.start, hit.query);
  };

  const pick = (c: MentionCandidate) => {
    if (!picker) return;
    const end = picker.start + 1 + picker.query.length;
    const next = `${body.slice(0, picker.start)}@${c.name} ${body.slice(end)}`;
    setBody(next);
    setPicked((m) => new Map(m).set(c.id, c.name));
    setPicker(null);
    const caret = picker.start + c.name.length + 2;
    requestAnimationFrame(() => ref.current?.setSelectionRange(caret, caret));
  };

  const submit = async () => {
    const text = body.trim();
    if (!text || busy || text.length > LIMITS.COMMENT_BODY_MAX) return;
    setBusy(true);
    try {
      if (await onSubmit(text, activeMentionIds(text, picked))) { setBody(''); setPicked(new Map()); }
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && isComposing(e)) return;
    if (picker && picker.items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPicker({ ...picker, active: (picker.active + 1) % picker.items.length }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPicker({ ...picker, active: (picker.active - 1 + picker.items.length) % picker.items.length }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(picker.items[picker.active]); return; }
    }
    if (e.key === 'Escape') {
      if (picker) { e.preventDefault(); setPicker(null); return; }
      onCancel?.();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
  };

  return (
    <div className="relative">
      {anchor && (
        <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          {anchor.kind === 'time' ? `at ${formatMs(anchor.ms)}` : `p. ${anchor.page}`}
          <button type="button" aria-label="Remove anchor" className="rounded-full hover:bg-primary/15" onClick={onClearAnchor}>
            <X className="size-3" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          ref={(node) => { ref.current = node; if (inputRef) inputRef.current = node; }}
          value={body}
          autoFocus={autoFocus}
          placeholder={placeholder}
          rows={2}
          className="min-h-[44px] resize-none text-sm"
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby={body.length > COMMENT_COUNTER_FROM ? 'comment-length' : undefined}
        />
        <Button type="button" size="icon" aria-label={submitLabel} disabled={busy || !body.trim() || overLimit} onClick={() => void submit()}>
          <Send className="size-4" />
        </Button>
      </div>
      {/* Silent until the cap is close, so it is information rather than
          pressure. Turns destructive once it is actually over. */}
      {body.length > COMMENT_COUNTER_FROM && (
        <p
          id="comment-length"
          aria-live="polite"
          className={`mt-1 text-xs tabular-nums ${overLimit ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {body.length.toLocaleString()} / {LIMITS.COMMENT_BODY_MAX.toLocaleString()}
        </p>
      )}
      {picker && (picker.items.length > 0 || picker.failed) && (
        <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-20 mb-1 w-64 overflow-hidden rounded-lg border bg-popover shadow-lg">
          {picker.failed ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Couldn't load people</li>
          ) : picker.items.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === picker.active}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === picker.active ? 'bg-muted' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
            >
              <AtSign className="size-3.5 text-muted-foreground" />
              <span className="truncate">{c.name}</span>
              {c.email && <span className="ml-auto truncate text-[11px] text-muted-foreground">{c.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

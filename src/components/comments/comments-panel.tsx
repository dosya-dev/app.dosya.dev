import { useEffect, useRef, useState } from 'react';
import { CornerDownRight, Pencil, Trash2, MessageSquare } from 'lucide-react';
import { api } from '@/api/client';
import { toast } from '@/lib/toast';
import { timeAgo } from '@/lib/helpers';
import { useAnchorTarget, useAnchorMarkers } from './anchor-context';
import { anchorLabel, isOlderVersion } from './format';
import { CommentBody } from './comment-body';
import { MentionComposer } from './mention-composer';
import { deleteComment, editComment, postComment } from './api';
import type { Comment, DraftAnchor } from './types';
import type { useFileComments } from './use-file-comments';

interface Props {
  fileId: string;
  workspaceId: string;
  currentVersion: number | null;
  viewingVersion: number | null;
  thread: ReturnType<typeof useFileComments>;
  activeCommentId: string | null;
}

export function CommentsPanel({ fileId, workspaceId, currentVersion, viewingVersion, thread, activeCommentId }: Props) {
  const target = useAnchorTarget();
  const { selectComment } = useAnchorMarkers();
  const [me, setMe] = useState<{ id: string } | null>(null);
  const [anchor, setAnchor] = useState<DraftAnchor>(null);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => { api<{ user: { id: string } }>('/api/me').then((d) => setMe(d.user), () => {}); }, []);
  // A deep link names the comment before its row exists (the thread loads
  // after mount), so wait for the row, then scroll once per selection: a later
  // post or reload must not yank the list back to it.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCommentId || scrolledFor.current === activeCommentId) return;
    const el = rowRefs.current.get(activeCommentId);
    if (!el) return;
    scrolledFor.current = activeCommentId;
    el.scrollIntoView?.({ block: 'nearest' });
  }, [activeCommentId, thread.comments]);

  // Removing the chip means "not about a moment": refocusing must not capture
  // it again. Cleared once the comment is posted, so the next one captures.
  const [anchorDismissed, setAnchorDismissed] = useState(false);

  // Capturing on focus, pausing on focus: you comment on the moment you heard.
  const captureAnchor = () => {
    if (replyTo || !target || anchor || anchorDismissed) return;
    if (target.kind === 'time') { target.pause(); setAnchor({ kind: 'time', ms: Math.round(target.now()) }); }
    else setAnchor({ kind: 'page', page: target.now() });
  };

  // Selecting is what says "left on vN": the viewer's onSelectComment does it
  // for the chip here and for every player marker alike (olderVersionNote).
  const jump = (c: Comment) => {
    if (!target) return;
    if (c.anchor_ms != null && target.kind === 'time') target.seek(c.anchor_ms);
    else if (c.anchor_page != null && target.kind === 'page') target.goTo(c.anchor_page);
    else return;
    selectComment(c.id);
  };

  const roots = thread.comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => thread.comments.filter((c) => c.parent_id === id);

  const submit = async (body: string, mentionIds: string[]) => {
    try {
      const created = await postComment({
        workspaceId, fileId, body, parentId: replyTo?.id ?? null,
        anchor: replyTo ? null : anchor, anchorVersion: viewingVersion ?? currentVersion, mentionIds,
      });
      thread.setComments([...thread.comments, created]);
      setAnchor(null);
      setAnchorDismissed(false);
      setReplyTo(null);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post comment');
      return false;
    }
  };

  const row = (c: Comment, isReply: boolean) => {
    const label = anchorLabel(c);
    const old = isOlderVersion(c, currentVersion);
    const mine = me?.id === c.user_id;
    return (
      <li
        key={c.id}
        ref={(el) => { if (el) rowRefs.current.set(c.id, el); else rowRefs.current.delete(c.id); }}
        className={`rounded-lg px-2 py-2 ${isReply ? 'ml-5' : ''} ${activeCommentId === c.id ? 'ring-2 ring-primary/40' : ''}`}
      >
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium">{c.user_name}</span>
          <span className="text-muted-foreground">{timeAgo(c.created_at)}</span>
          {label && (
            <button type="button" className="rounded-full bg-primary/10 px-1.5 font-mono text-[11px] text-primary hover:bg-primary/20" onClick={() => jump(c)}>
              {c.anchor_ms != null ? `▶ ${label}` : label}
            </button>
          )}
          {old && <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">v{c.anchor_version}</span>}
        </div>
        {editing === c.id ? (
          <div className="mt-1">
            <MentionComposer
              workspaceId={workspaceId} fileId={fileId} autoFocus submitLabel="Save"
              initialBody={c.body} initialMentions={c.mentions}
              onCancel={() => setEditing(null)}
              onSubmit={async (body, ids) => {
                try {
                  await editComment(c.id, body, ids);
                  await thread.reload();
                  setEditing(null);
                  return true;
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not save');
                  return false;
                }
              }}
            />
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm"><CommentBody body={c.body} mentions={c.mentions} /></p>
        )}
        <div className="mt-1 flex gap-2 text-[11px] text-muted-foreground">
          {!isReply && <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => { setReplyTo(c); setAnchor(null); }}><CornerDownRight className="size-3" />Reply</button>}
          {mine && <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setEditing(c.id)}><Pencil className="size-3" />Edit</button>}
          {mine && (
            <button
              type="button"
              aria-label="Delete comment"
              className="inline-flex items-center gap-1 hover:text-destructive"
              onClick={async () => {
                try { await deleteComment(c.id); await thread.reload(); } catch { toast.error('Could not delete'); }
              }}
            >
              <Trash2 className="size-3" />Delete
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {thread.loading ? null : thread.error ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Couldn't load comments</p>
        ) : roots.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            <MessageSquare className="mx-auto mb-2 size-5" />No comments yet
          </div>
        ) : (
          <ul className="space-y-1">
            {roots.flatMap((r) => [row(r, false), ...repliesOf(r.id).map((x) => row(x, true))])}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t pt-3">
        {replyTo && (
          <p className="mb-1 text-[11px] text-muted-foreground">
            Replying to {replyTo.user_name}{' '}
            <button type="button" className="underline" onClick={() => setReplyTo(null)}>cancel</button>
          </p>
        )}
        <MentionComposer
          workspaceId={workspaceId}
          fileId={fileId}
          anchor={replyTo ? null : anchor}
          onClearAnchor={() => { setAnchor(null); setAnchorDismissed(true); }}
          onFocus={captureAnchor}
          onSubmit={submit}
        />
      </div>
    </div>
  );
}

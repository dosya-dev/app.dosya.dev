import { formatDateWith, localDigits } from '@/lib/format-locale';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Textarea } from '@/components/ui/textarea';
import type { Comment } from '@/components/comments/types';
import { CommentBody } from '@/components/comments/comment-body';
import { MentionComposer } from '@/components/comments/mention-composer';
import { listComments, postComment } from '@/components/comments/api';
import { anchorLabel } from '@/components/comments/format';
import { viewerHref } from '@/components/comments/deep-link';
import {
  ChevronLeft, CornerDownRight, Pencil, Trash2, X,
  Loader2, MessageSquare,
} from 'lucide-react';
import { FilePreviewImage } from '@/components/file-preview-image';
import {
  humanSize, timeAgo, isImage, fileIconSrc, colorFor,
  avatarColor, initials,
} from '@/lib/helpers';
import { toast } from '@/lib/toast';
import { t as tModule, useT } from '@/lib/i18n';
import { validateCommentBody } from '@/lib/validation-policy.generated';
import { translateExternal } from '@/lib/external-text';

// ── Types ─────────────────────────────────────────────────

interface CurrentUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

interface FileInfo {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string;
  extension: string;
  region: string;
  created_at: number;
  updated_at: number;
  uploader_name: string;
}

// ── Helpers ───────────────────────────────────────────────

function formatDateSep(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return tModule('common.label.today');
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return tModule('common.label.yesterday');
  return formatDateWith(d, { month: 'long', day: 'numeric', year: 'numeric' }, 'en-US');
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return formatDateWith(d, { hour: '2-digit', minute: '2-digit' }, 'en-US');
}

function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── Page ──────────────────────────────────────────────────

export default function CommentsPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);

  const fileId = searchParams.get('file_id');
  const fileName = searchParams.get('name') || t('common.label.fileTitleCase');
  const highlightId = searchParams.get('comment');

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);

  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // The linked comment is scrolled to once; later posts scroll to the newest.
  const scrolledToHighlight = useRef(false);

  // Load current user
  useEffect(() => {
    api<{ user: CurrentUser }>('/api/me')
      .then((d) => setCurrentUser(d.user))
      .catch(() => {});
  }, []);

  // Load file info: the one file, by id. (This used to page the workspace's
  // root listing, 500 rows, and look for the file in it, which was slow and
  // never found a file inside a folder.)
  useEffect(() => {
    if (!fileId) return;
    api<{ ok: boolean; file: FileInfo }>(`/api/files/${encodeURIComponent(fileId)}`)
      .then((d) => { if (d.file) setFileInfo(d.file); })
      .catch(() => {});
  }, [fileId]);

  // Load comments. The spinner is for the first load only; a refresh after an
  // edit or delete swaps the list in place instead of blanking it.
  const loadedOnce = useRef(false);
  useEffect(() => { loadedOnce.current = false; }, [fileId, wsId]);
  const loadComments = useCallback(async () => {
    if (!fileId || !wsId) return;
    if (!loadedOnce.current) setLoading(true);
    try {
      setComments(await listComments(fileId, wsId));
      loadedOnce.current = true;
    } catch {}
    setLoading(false);
  }, [fileId, wsId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Scroll to the linked comment when there is one, else to the newest.
  useEffect(() => {
    const target = highlightId && !scrolledToHighlight.current ? document.getElementById(`comment-${highlightId}`) : null;
    if (target) { scrolledToHighlight.current = true; target.scrollIntoView?.({ block: 'center' }); }
    else if (!highlightId || scrolledToHighlight.current) chatEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [comments, highlightId]);

  // Submit comment (the composer owns the draft and the length cap)
  const handleSubmit = async (body: string, mentionIds: string[]): Promise<boolean> => {
    if (!fileId) return false;
    try {
      // The server returns the stored comment; add it rather than reloading
      // the whole thread.
      const posted = await postComment({ workspaceId: wsId, fileId, body, parentId: replyTo?.id ?? null, mentionIds });
      setComments((list) => [...list, posted]);
      setReplyTo(null);
      return true;
    } catch {
      toast.error(t('comments.error.commentFailed'), t('comments.error.yourCommentCouldNotBePosted'));
      return false;
    }
  };

  const handleEdit = async (id: string) => {
    if (!editBody.trim()) return;
    const editError = validateCommentBody(editBody);
    if (editError) { toast.error(t('comments.error.editFailed'), translateExternal(editError, 'toast')); return; }
    try {
      await api(`/api/comments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ body: editBody.trim() }),
      });
      setEditId(null);
      loadComments();
    } catch {
      toast.error(t('comments.error.editFailed'), t('comments.error.yourCommentCouldNotBeUpdated'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/comments/${id}`, { method: 'DELETE' });
      loadComments();
    } catch {
      toast.error(t('common.error.deleteFailed'), t('comments.error.yourCommentCouldNotBeDeleted'));
    }
  };

  // Sort chronologically and build grouped structure
  const sorted = [...comments].sort((a, b) => a.created_at - b.created_at);

  const info = fileInfo;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/files" className="size-8 rounded-md flex items-center justify-center hover:bg-muted shrink-0">
            <ChevronLeft className="size-4 text-muted-foreground rtl:-scale-x-100" />
          </Link>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${isImage(fileName) ? 'bg-muted' : ''}`} style={isImage(fileName) ? undefined : { background: colorFor(fileName) + '20' }}>
            {fileId ? (
              <FilePreviewImage
                fileId={fileId}
                fileName={fileName}
                size={128}
                className="w-full h-full object-cover"
                fallback={<img src={fileIconSrc(fileName)} alt="" className="size-5" />}
              />
            ) : (
              <img src={fileIconSrc(fileName)} alt="" className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{fileName}</p>
            <p className="text-[11px] text-muted-foreground">{t('comments.label.fileConversation')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {comments.length > 0 && (
            <span className="text-[11px] font-semibold bg-primary text-primary-foreground rounded-full px-2 py-0.5">
              {localDigits(comments.length)}
            </span>
          )}
        </div>
      </div>

      {/* Content: Chat + Detail Panel */}
      <div className="flex-1 flex min-h-0">
        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                <Loader2 className="size-5 animate-spin" />
                <span className="text-xs">{t('comments.description.loadingMessages')}</span>
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <MessageSquare className="size-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{t('comments.label.noMessagesYet')}</p>
                <p className="text-xs text-muted-foreground">{t('comments.description.startTheConversationOnThisFile')}</p>
              </div>
            ) : (
              <ChatMessages
                comments={sorted}
                allComments={comments}
                currentUser={currentUser}
                highlightId={highlightId}
                editId={editId}
                editBody={editBody}
                onReply={(c) => { setReplyTo(c); inputRef.current?.focus(); }}
                onStartEdit={(id, body) => { setEditId(id); setEditBody(body); }}
                onCancelEdit={() => setEditId(null)}
                onSaveEdit={handleEdit}
                onEditBodyChange={setEditBody}
                onDelete={handleDelete}
              />
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Reply bar */}
          {replyTo && (
            <div className="flex items-center gap-2 px-5 py-2 bg-muted/50 border-t text-xs text-muted-foreground">
              <CornerDownRight className="size-3 shrink-0 rtl:-scale-x-100" />
              <span className="truncate">
                {t('comments.description.replyingToReplytouserNameBodysliceReplytobodylengthSelectTrueOther', {
                  replyToUser_name: replyTo.user_name,
                  bodySlice: replyTo.body.slice(0, 60),
                  replyToBodyLength: replyTo.body.length > 60 ? 'true' : 'false',
                })}
              </span>
              <button onClick={() => setReplyTo(null)} className="ms-auto shrink-0"><X className="size-3" /></button>
            </div>
          )}

          {/* Composer */}
          <div className="px-5 py-3 border-t shrink-0">
            <div className="flex items-end gap-3">
              {/* Avatar */}
              <div
                className="size-8 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: currentUser ? avatarColor(currentUser.id) : '#a0a0a0' }}
              >
                {currentUser ? initials(currentUser.name) : '?'}
              </div>
              {/* Input */}
              <div className="flex-1 min-w-0">
                {fileId && (
                  <MentionComposer
                    workspaceId={wsId}
                    fileId={fileId}
                    placeholder={t('comments.placeholder.writeAMessage')}
                    onSubmit={handleSubmit}
                    inputRef={inputRef}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right detail panel */}
        <aside className="w-[280px] shrink-0 border-s overflow-y-auto hidden lg:block">
          <div className="p-4 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t('common.label.fileDetails')}</p>

            {/* Preview */}
            <div className={`w-full h-28 rounded-lg flex items-center justify-center overflow-hidden mb-3 ${isImage(fileName) ? 'bg-muted' : ''}`} style={isImage(fileName) ? undefined : { background: colorFor(fileName) + '18' }}>
              {fileId ? (
                <FilePreviewImage
                  fileId={fileId}
                  fileName={fileName}
                  size={256}
                  className="w-full h-full object-contain"
                  fallback={<img src={fileIconSrc(fileName)} alt="" className="size-16" />}
                />
              ) : (
                <img src={fileIconSrc(fileName)} alt="" className="size-16" />
              )}
            </div>

            <p className="text-sm font-semibold break-all mb-1">{fileName}</p>
            {info && (
              <p className="text-xs text-muted-foreground">{t('comments.label.infosizeBytesMiddotInfomimeTypeMiddotInfocreatedAt', { infoSize_bytes: humanSize(info.size_bytes), infoMime_type: info.mime_type, infoCreated_at: timeAgo(info.created_at) })}</p>
            )}
          </div>

          {/* Properties */}
          {info && (
            <div className="p-4 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('common.label.properties')}</p>
              <div className="space-y-1.5">
                <PropRow label={t('common.label.uploadedBy')} value={info.uploader_name ?? t('common.label.unknown')} />
                <PropRow label={t('common.label.size')} value={humanSize(info.size_bytes)} />
                <PropRow label={t('common.label.type')} value={info.mime_type || '-'} />
                <PropRow label={t('common.label.region')} value={info.region || '-'} />
                <PropRow label={t('common.label.created')} value={timeAgo(info.created_at)} />
                <PropRow label={t('common.label.modified')} value={timeAgo(info.updated_at)} />
                <PropRow label={t('common.label.extension')} value={info.extension ?? '-'} />
              </div>
            </div>
          )}

          {/* Actions */}
          {fileId && (
            <div className="p-4 space-y-1.5">
              <a
                href={`${API_BASE}/api/files/${fileId}/raw`}
                target="_blank"
                className="flex items-center gap-2 h-10 px-3 rounded-md border text-xs font-medium hover:bg-muted/50 w-full"
              >
                {t('common.action.viewFile')}
              </a>
              <a
                href={`${API_BASE}/api/files/${fileId}/download`}
                download
                className="flex items-center gap-2 h-10 px-3 rounded-md bg-green-500 text-white text-xs font-medium hover:bg-green-600 w-full"
              >
                {t('common.action.download')}
              </a>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Chat messages ─────────────────────────────────────────

// user_avatar is an R2 object key, not a URL - treat it as a "has photo" flag
// and load the image through the API (cookie-authenticated), falling back to
// initials if it's missing or fails to load. Same rule as the dashboard's
// activity rows.
function CommentAvatar({ comment, displayName, bgColor }: { comment: Comment; displayName: string; bgColor: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className="size-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
      style={{ background: bgColor }}
    >
      {comment.user_avatar && !failed ? (
        <img
          src={`${API_BASE}/api/users/${comment.user_id}/avatar`}
          alt=""
          crossOrigin="use-credentials"
          className="w-full h-full rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(displayName)
      )}
    </div>
  );
}

function ChatMessages({ comments, allComments, currentUser, highlightId, editId, editBody, onReply, onStartEdit, onCancelEdit, onSaveEdit, onEditBodyChange, onDelete }: {
  comments: Comment[];
  allComments: Comment[];
  currentUser: CurrentUser | null;
  highlightId: string | null;
  editId: string | null;
  editBody: string;
  onReply: (c: Comment) => void;
  onStartEdit: (id: string, body: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onEditBodyChange: (body: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  let lastDay = '';
  let lastUserId = '';
  let lastSide = '';

  return (
    <div className="space-y-0.5">
      {comments.map((c, i) => {
        const isMine = currentUser && c.user_id === currentUser.id;
        const side = isMine ? 'mine' : 'other';
        const dk = dayKey(c.created_at);
        const next = comments[i + 1];
        const nextSameSide = next && ((currentUser && next.user_id === currentUser.id) ? 'mine' : 'other') === side && dayKey(next.created_at) === dk;
        const prevSameSide = lastSide === side && lastDay === dk;

        const showDateSep = dk !== lastDay;
        const isFirstInGroup = !prevSameSide || lastUserId !== c.user_id;
        const isLastInGroup = !nextSameSide || (next && next.user_id !== c.user_id);

        const showAvatar = isLastInGroup;
        const showName = isFirstInGroup && !isMine;
        const showMeta = isLastInGroup;

        lastDay = dk;
        lastUserId = c.user_id;
        lastSide = side;

        // Reply parent
        const parent = c.parent_id ? allComments.find((x) => x.id === c.parent_id) : null;

        const displayName = c.user_name || c.user_email;
        const bgColor = avatarColor(c.user_id);
        const isEditing = editId === c.id;

        return (
          <div
            key={c.id}
            id={`comment-${c.id}`}
            className={highlightId === c.id ? 'ring-2 ring-primary/40 rounded-lg' : ''}
          >
            {/* Date separator */}
            {showDateSep && (
              <div className="flex items-center justify-center my-4">
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
                  {formatDateSep(c.created_at)}
                </span>
              </div>
            )}

            {/* Message */}
            <div className={`flex gap-2.5 group ${isMine ? 'flex-row-reverse' : ''} ${isFirstInGroup ? 'mt-3' : 'mt-0.5'}`}>
              {/* Avatar */}
              <div className="w-8 shrink-0 flex items-end">
                {showAvatar && (
                  <CommentAvatar comment={c} displayName={displayName} bgColor={bgColor} />
                )}
              </div>

              {/* Bubble */}
              <div className={`max-w-[70%] min-w-0 ${isMine ? 'items-end' : 'items-start'}`}>
                {showName && (
                  <p className="text-[11px] font-semibold text-muted-foreground mb-0.5 px-1"><bdi>{displayName}</bdi></p>
                )}

                {anchorLabel(c) && c.file_id && (
                  <Link to={viewerHref(c.file_id, c)} className="mb-0.5 inline-block rounded-full bg-primary/10 px-1.5 font-mono text-[11px] text-primary hover:bg-primary/20">
                    {c.anchor_ms != null ? `\u25B6 ${anchorLabel(c)}` : anchorLabel(c)}
                  </Link>
                )}

                <div className="relative group/bubble">
                  {/* Hover actions. rtl-ok: mirrored, rtl: counterpart on the same element */}
                  <div className={`absolute top-0 ${isMine ? 'inset-s-0 -translate-x-full rtl:translate-x-full' : 'inset-e-0 translate-x-full rtl:-translate-x-full'} flex items-center gap-0.5 px-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity`}>
                    <button className="size-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => onReply(c)} title={t('common.tooltip.reply')}>
                      <CornerDownRight className="size-3 text-muted-foreground rtl:-scale-x-100" />
                    </button>
                    {isMine && (
                      <>
                        <button className="size-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => onStartEdit(c.id, c.body)} title={t('common.edit')}>
                          <Pencil className="size-3 text-muted-foreground" />
                        </button>
                        <button className="size-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => onDelete(c.id)} title={t('common.delete')}>
                          <Trash2 className="size-3 text-destructive" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Reply quote */}
                  {parent && (
                    <div className={`text-[10px] px-2.5 py-1 rounded-t-lg border-s-2 border-primary/40 bg-muted/50 text-muted-foreground`}>
                      <span className="font-semibold"><bdi>{parent.user_name}</bdi></span>: <bdi dir="auto">{parent.body.slice(0, 60)}{parent.body.length > 60 ? '...' : ''}</bdi>
                    </div>
                  )}

                  {/* Content */}
                  {isEditing ? (
                    <div className={`px-3 py-2 rounded-xl ${isMine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                      <Textarea
                        value={editBody}
                        onChange={(e) => onEditBodyChange(e.target.value)}
                        className="w-full min-h-8 border-0 rounded-none p-0 bg-transparent dark:bg-transparent text-sm resize-none focus-visible:ring-0"
                        autoFocus
                      />
                      <div className="flex gap-1 mt-1">
                        <button className="text-[10px] font-medium underline" onClick={() => onSaveEdit(c.id)}>{t('common.save')}</button>
                        <button className="text-[10px] font-medium underline opacity-60" onClick={onCancelEdit}>{t('common.cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <div dir="auto" className={`px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      isMine
                        ? `bg-primary text-primary-foreground ${isFirstInGroup ? 'rounded-2xl rounded-ee-md' : isLastInGroup ? 'rounded-2xl rounded-se-md' : 'rounded-e-md rounded-s-2xl'}`
                        : `bg-muted ${isFirstInGroup ? 'rounded-2xl rounded-es-md' : isLastInGroup ? 'rounded-2xl rounded-ss-md' : 'rounded-s-md rounded-e-2xl'}`
                    } ${parent ? 'rounded-t-none' : ''}`}>
                      <CommentBody body={c.body} mentions={c.mentions ?? []} />
                    </div>
                  )}
                </div>

                {showMeta && (
                  <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isMine ? 'justify-end' : ''}`}>
                    <span className="text-[10px] text-muted-foreground">{formatTime(c.created_at)}</span>
                    {c.is_edited === 1 && <span className="text-[10px] text-muted-foreground italic">{t('comments.label.edited')}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium truncate max-w-32 text-end">{value}</span>
    </div>
  );
}

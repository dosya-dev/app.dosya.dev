import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api, API_BASE } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ChevronLeft, Send, CornerDownRight, Pencil, Trash2, X,
  Loader2, MessageSquare,
} from 'lucide-react';
import { FilePreviewImage } from '@/components/file-preview-image';
import {
  humanSize, timeAgo, isImage, fileIconSrc, colorFor,
  avatarColor, initials,
} from '@/lib/helpers';
import { toast } from '@/lib/toast';


// ── Types ─────────────────────────────────────────────────

interface Comment {
  id: string;
  file_id: string | null;
  folder_id: string | null;
  workspace_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  is_edited: number;
  created_at: number;
  updated_at: number;
  user_name: string;
  user_email: string;
  user_avatar: string | null;
}

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
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// ── Page ──────────────────────────────────────────────────

export default function CommentsPage() {
  const [searchParams] = useSearchParams();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);

  const fileId = searchParams.get('file_id');
  const fileName = searchParams.get('name') || 'File';

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);

  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load current user
  useEffect(() => {
    api<{ user: CurrentUser }>('/api/me')
      .then((d) => setCurrentUser(d.user))
      .catch(() => {});
  }, []);

  // Load file info
  useEffect(() => {
    if (!fileId) return;
    api<{ ok: boolean; files: FileInfo[] }>(`/api/files?workspace_id=${wsId}&per_page=500`)
      .then((d) => {
        const f = d.files?.find((x) => x.id === fileId);
        if (f) setFileInfo(f);
      })
      .catch(() => {});
  }, [fileId, wsId]);

  // Load comments
  const loadComments = useCallback(async () => {
    if (!fileId || !wsId) return;
    setLoading(true);
    try {
      const data = await api<{ ok: boolean; comments: Comment[] }>(
        `/api/comments?file_id=${fileId}&workspace_id=${wsId}`
      );
      if (data.ok) setComments(data.comments || []);
    } catch {}
    setLoading(false);
  }, [fileId, wsId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Scroll to bottom on new comments
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  // Submit comment
  const handleSubmit = async () => {
    if (!body.trim() || !fileId) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        file_id: fileId,
        workspace_id: wsId,
        body: body.trim(),
      };
      if (replyTo) payload.parent_id = replyTo.id;
      const res = await api<{ ok: boolean }>('/api/comments', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setBody('');
        setReplyTo(null);
        loadComments();
      }
    } catch {
      toast.error('Comment failed', 'Your comment could not be posted.');
    }
    setSubmitting(false);
  };

  const handleEdit = async (id: string) => {
    if (!editBody.trim()) return;
    try {
      await api(`/api/comments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ body: editBody.trim() }),
      });
      setEditId(null);
      loadComments();
    } catch {
      toast.error('Edit failed', 'Your comment could not be updated.');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/comments/${id}`, { method: 'DELETE' });
      loadComments();
    } catch {
      toast.error('Delete failed', 'Your comment could not be deleted.');
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
            <ChevronLeft className="size-4 text-muted-foreground" />
          </Link>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${isImage(fileName) ? 'bg-muted' : ''}`} style={isImage(fileName) ? undefined : { background: colorFor(fileName) + '20' }}>
            {fileId ? (
              <FilePreviewImage
                fileId={fileId}
                fileName={fileName}
                maxDim={128}
                className="w-full h-full object-cover"
                fallback={<img src={fileIconSrc(fileName)} alt="" className="size-5" />}
              />
            ) : (
              <img src={fileIconSrc(fileName)} alt="" className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{fileName}</p>
            <p className="text-[11px] text-muted-foreground">File conversation</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {comments.length > 0 && (
            <span className="text-[11px] font-semibold bg-primary text-primary-foreground rounded-full px-2 py-0.5">
              {comments.length}
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
                <span className="text-xs">Loading messages...</span>
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="size-12 rounded-full bg-muted flex items-center justify-center mb-3">
                  <MessageSquare className="size-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground mb-1">No messages yet</p>
                <p className="text-xs text-muted-foreground">Start the conversation on this file.</p>
              </div>
            ) : (
              <ChatMessages
                comments={sorted}
                allComments={comments}
                currentUser={currentUser}
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
              <CornerDownRight className="size-3 shrink-0" />
              <span className="truncate">
                Replying to <span className="font-semibold text-foreground">{replyTo.user_name}</span>: {replyTo.body.slice(0, 60)}{replyTo.body.length > 60 ? '...' : ''}
              </span>
              <button onClick={() => setReplyTo(null)} className="ml-auto shrink-0"><X className="size-3" /></button>
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
              <Textarea
                ref={inputRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                placeholder="Write a message..."
                className="flex-1 min-h-10 max-h-32 rounded-lg px-3 py-2.5 text-sm bg-background resize-none"
                rows={1}
              />
              {/* Send */}
              <Button
                size="sm"
                className="size-10 p-0 shrink-0 rounded-full"
                onClick={handleSubmit}
                disabled={submitting || !body.trim()}
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Right detail panel */}
        <aside className="w-[280px] shrink-0 border-l overflow-y-auto hidden lg:block">
          <div className="p-4 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">File details</p>

            {/* Preview */}
            <div className={`w-full h-28 rounded-lg flex items-center justify-center overflow-hidden mb-3 ${isImage(fileName) ? 'bg-muted' : ''}`} style={isImage(fileName) ? undefined : { background: colorFor(fileName) + '18' }}>
              {fileId ? (
                <FilePreviewImage
                  fileId={fileId}
                  fileName={fileName}
                  maxDim={256}
                  className="w-full h-full object-contain"
                  fallback={<img src={fileIconSrc(fileName)} alt="" className="size-16" />}
                />
              ) : (
                <img src={fileIconSrc(fileName)} alt="" className="size-16" />
              )}
            </div>

            <p className="text-sm font-semibold break-all mb-1">{fileName}</p>
            {info && (
              <p className="text-xs text-muted-foreground">{humanSize(info.size_bytes)} &middot; {info.mime_type} &middot; {timeAgo(info.created_at)}</p>
            )}
          </div>

          {/* Properties */}
          {info && (
            <div className="p-4 border-b">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Properties</p>
              <div className="space-y-1.5">
                <PropRow label="Uploaded by" value={info.uploader_name ?? 'Unknown'} />
                <PropRow label="Size" value={humanSize(info.size_bytes)} />
                <PropRow label="Type" value={info.mime_type || '—'} />
                <PropRow label="Region" value={info.region || '—'} />
                <PropRow label="Created" value={timeAgo(info.created_at)} />
                <PropRow label="Modified" value={timeAgo(info.updated_at)} />
                <PropRow label="Extension" value={info.extension ?? '—'} />
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
                View file
              </a>
              <a
                href={`${API_BASE}/api/files/${fileId}/download`}
                download
                className="flex items-center gap-2 h-10 px-3 rounded-md bg-green-500 text-white text-xs font-medium hover:bg-green-600 w-full"
              >
                Download
              </a>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Chat messages ─────────────────────────────────────────

function ChatMessages({ comments, allComments, currentUser, editId, editBody, onReply, onStartEdit, onCancelEdit, onSaveEdit, onEditBodyChange, onDelete }: {
  comments: Comment[];
  allComments: Comment[];
  currentUser: CurrentUser | null;
  editId: string | null;
  editBody: string;
  onReply: (c: Comment) => void;
  onStartEdit: (id: string, body: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string) => void;
  onEditBodyChange: (body: string) => void;
  onDelete: (id: string) => void;
}) {
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
          <div key={c.id}>
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
                  <div
                    className="size-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ background: bgColor }}
                  >
                    {c.user_avatar ? (
                      <img src={c.user_avatar} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      initials(displayName)
                    )}
                  </div>
                )}
              </div>

              {/* Bubble */}
              <div className={`max-w-[70%] min-w-0 ${isMine ? 'items-end' : 'items-start'}`}>
                {showName && (
                  <p className="text-[11px] font-semibold text-muted-foreground mb-0.5 px-1">{displayName}</p>
                )}

                <div className="relative group/bubble">
                  {/* Hover actions */}
                  <div className={`absolute top-0 ${isMine ? 'left-0 -translate-x-full' : 'right-0 translate-x-full'} flex items-center gap-0.5 px-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity`}>
                    <button className="size-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => onReply(c)} title="Reply">
                      <CornerDownRight className="size-3 text-muted-foreground" />
                    </button>
                    {isMine && (
                      <>
                        <button className="size-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => onStartEdit(c.id, c.body)} title="Edit">
                          <Pencil className="size-3 text-muted-foreground" />
                        </button>
                        <button className="size-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => onDelete(c.id)} title="Delete">
                          <Trash2 className="size-3 text-destructive" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Reply quote */}
                  {parent && (
                    <div className={`text-[10px] px-2.5 py-1 rounded-t-lg border-l-2 border-primary/40 bg-muted/50 text-muted-foreground ${isMine ? 'rounded-tr-lg' : 'rounded-tl-lg'}`}>
                      <span className="font-semibold">{parent.user_name}</span>: {parent.body.slice(0, 60)}{parent.body.length > 60 ? '...' : ''}
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
                        <button className="text-[10px] font-medium underline" onClick={() => onSaveEdit(c.id)}>Save</button>
                        <button className="text-[10px] font-medium underline opacity-60" onClick={onCancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      isMine
                        ? `bg-primary text-primary-foreground ${isFirstInGroup ? 'rounded-2xl rounded-br-md' : isLastInGroup ? 'rounded-2xl rounded-tr-md' : 'rounded-r-md rounded-l-2xl'}`
                        : `bg-muted ${isFirstInGroup ? 'rounded-2xl rounded-bl-md' : isLastInGroup ? 'rounded-2xl rounded-tl-md' : 'rounded-l-md rounded-r-2xl'}`
                    } ${parent ? 'rounded-t-none' : ''}`}>
                      {c.body}
                    </div>
                  )}
                </div>

                {showMeta && (
                  <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isMine ? 'justify-end' : ''}`}>
                    <span className="text-[10px] text-muted-foreground">{formatTime(c.created_at)}</span>
                    {c.is_edited === 1 && <span className="text-[10px] text-muted-foreground italic">edited</span>}
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
      <span className="text-xs font-medium truncate max-w-32 text-right">{value}</span>
    </div>
  );
}

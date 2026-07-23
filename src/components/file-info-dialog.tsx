import { useState } from 'react';
import { Copy, Check, Lock, EyeOff, Share2, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FilePreviewImage } from '@/components/file-preview-image';
import {
  humanSize, extOf, regionLabel, colorFor, folderIconSrc, fileIconSrc, isImage,
} from '@/lib/helpers';

interface FileLike {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string;
  region: string; created_at: number; updated_at: number; current_version: number;
  lock_mode: string; is_hidden: number; uploader_name: string; share_count: number; comment_count: number;
}
interface FolderLike {
  id: string; name: string; created_at: number; file_count: number; lock_mode: string; is_hidden: number;
  total_size_bytes: number; content_updated_at: number; region: string | null; uploader_name?: string | null;
}

export type InfoTarget =
  | { type: 'file'; item: FileLike }
  | { type: 'folder'; item: FolderLike };

function fullDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function FileInfoDialog({ target, location, onClose }: {
  target: InfoTarget | null;
  location?: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        {target?.type === 'file' && <FileInfo file={target.item} location={location} />}
        {target?.type === 'folder' && <FolderInfo folder={target.item} location={location} />}
      </DialogContent>
    </Dialog>
  );
}

// ── shared bits ────────────────────────────────────────────
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words select-text">{children}</span>
    </div>
  );
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}
      className="group inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
      title="Copy ID"
    >
      <span className="break-all">{id}</span>
      {copied ? <Check className="size-3 text-green-600 shrink-0" /> : <Copy className="size-3 shrink-0 opacity-0 group-hover:opacity-100" />}
    </button>
  );
}

function StatusBadges({ lock_mode, is_hidden }: { lock_mode: string; is_hidden: number }) {
  if (lock_mode === 'none' && !is_hidden) return <span className="text-muted-foreground">Normal</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {lock_mode !== 'none' && (
        <Badge variant="secondary" className="gap-1"><Lock className="size-3 text-violet-600" /> {lock_mode === 'full_lock' ? 'Locked' : 'Lock'}</Badge>
      )}
      {!!is_hidden && (
        <Badge variant="secondary" className="gap-1"><EyeOff className="size-3" /> Hidden</Badge>
      )}
    </span>
  );
}

function Header({ thumb, name, subtitle, version }: { thumb: React.ReactNode; name: string; subtitle: string; version?: number }) {
  return (
    <DialogHeader>
      <div className="flex items-center gap-3 text-left">
        <div className="size-14 shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center">{thumb}</div>
        <div className="min-w-0">
          <DialogTitle className="text-base leading-snug break-words flex items-center gap-2">
            <span className="min-w-0 break-words">{name}</span>
            {version && version > 1 && <Badge variant="secondary" className="text-[9px] shrink-0">v{version}</Badge>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
    </DialogHeader>
  );
}

// ── file ───────────────────────────────────────────────────
function FileInfo({ file, location }: { file: FileLike; location?: string }) {
  const ext = extOf(file.name).toUpperCase();
  const thumb = isImage(file.name)
    ? <FilePreviewImage fileId={file.id} fileName={file.name} size={128} className="w-full h-full object-cover" fallback={<span className="font-mono text-[10px] font-bold" style={{ color: colorFor(file.name) }}>{ext || 'FILE'}</span>} />
    : <img src={fileIconSrc(file.name)} alt="" className="size-8" />;

  return (
    <>
      <Header thumb={thumb} name={file.name} version={file.current_version}
        subtitle={`${file.mime_type || 'Unknown type'} · ${humanSize(file.size_bytes)}`} />
      <div className="divide-y">
        <Row label="Kind">{file.mime_type || 'Unknown'}{ext ? ` (.${ext.toLowerCase()})` : ''}</Row>
        <Row label="Size">{humanSize(file.size_bytes)} <span className="text-muted-foreground">({file.size_bytes.toLocaleString()} bytes)</span></Row>
        {location && <Row label="Where">{location}</Row>}
        <Row label="Created">{fullDate(file.created_at)}</Row>
        <Row label="Modified">{fullDate(file.updated_at)}</Row>
        <Row label="Versions">{file.current_version} {file.current_version === 1 ? 'version' : 'versions'}</Row>
        <Row label="Uploaded by">{file.uploader_name || '—'}</Row>
        <Row label="Region">{regionLabel(file.region)}</Row>
        <Row label="Sharing">
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><Share2 className="size-3.5 text-muted-foreground" /> {file.share_count} {file.share_count === 1 ? 'share' : 'shares'}</span>
            <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5 text-muted-foreground" /> {file.comment_count} {file.comment_count === 1 ? 'comment' : 'comments'}</span>
          </span>
        </Row>
        <Row label="Status"><StatusBadges lock_mode={file.lock_mode} is_hidden={file.is_hidden} /></Row>
        <Row label="ID"><CopyableId id={file.id} /></Row>
      </div>
    </>
  );
}

// ── folder ─────────────────────────────────────────────────
function FolderInfo({ folder, location }: { folder: FolderLike; location?: string }) {
  return (
    <>
      <Header thumb={<img src={folderIconSrc(folder.file_count)} alt="" className="size-9" />} name={folder.name}
        subtitle={`Folder · ${folder.file_count} ${folder.file_count === 1 ? 'item' : 'items'} · ${humanSize(folder.total_size_bytes)}`} />
      <div className="divide-y">
        <Row label="Kind">Folder</Row>
        <Row label="Items">{folder.file_count} {folder.file_count === 1 ? 'item' : 'items'}</Row>
        <Row label="Size">{humanSize(folder.total_size_bytes)} <span className="text-muted-foreground">({folder.total_size_bytes.toLocaleString()} bytes)</span></Row>
        {location && <Row label="Where">{location}</Row>}
        <Row label="Created">{fullDate(folder.created_at)}</Row>
        <Row label="Modified">{fullDate(folder.content_updated_at)}</Row>
        {folder.uploader_name != null && <Row label="Created by">{folder.uploader_name || '—'}</Row>}
        <Row label="Region">{folder.region ? regionLabel(folder.region) : '—'}</Row>
        <Row label="Status"><StatusBadges lock_mode={folder.lock_mode} is_hidden={folder.is_hidden} /></Row>
        <Row label="ID"><CopyableId id={folder.id} /></Row>
      </div>
    </>
  );
}

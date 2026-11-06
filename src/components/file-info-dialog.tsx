import { formatDateWith, formatNumber } from '@/lib/format-locale';
import { useState } from 'react';
import { Lock, EyeOff, Share2, MessageSquare } from 'lucide-react';
import { CopyCheck } from '@/components/ui/copy-check';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { FilePreviewImage } from '@/components/file-preview-image';
import {
  humanSize, extOf, regionLabel, colorFor, folderIconSrc, fileIconSrc, isImage,
} from '@/lib/helpers';
import { useT } from '@/lib/i18n';

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
  if (!ts) return '-';
  return formatDateWith(ts, {
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}
      className="group inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
      title={t('files.action.copyId')}
    >
      <span className="break-all">{id}</span>
      {/* The hover-reveal moved from the icon to the wrapper: the two icons
          own opacity now, so a second opacity rule on one of them would fight
          the cross-fade. */}
      <CopyCheck copied={copied} className="size-3 opacity-0 transition-opacity group-hover:opacity-100" checkClassName="text-green-600" />
    </button>
  );
}

function StatusBadges({ lock_mode, is_hidden }: { lock_mode: string; is_hidden: number }) {
  const t = useT();
  if (lock_mode === 'none' && !is_hidden) return <span className="text-muted-foreground">{t('files.status.normal')}</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {lock_mode !== 'none' && (
        <Badge variant="secondary" className="gap-1"><Lock className="size-3 text-violet-600" /> {lock_mode === 'full_lock' ? t('files.status.locked') : t('files.status.lock')}</Badge>
      )}
      {!!is_hidden && (
        <Badge variant="secondary" className="gap-1"><EyeOff className="size-3" /> {t('common.status.hidden')}</Badge>
      )}
    </span>
  );
}

function Header({ thumb, name, subtitle, version }: { thumb: React.ReactNode; name: string; subtitle: string; version?: number }) {
  const t = useT();
  return (
    <DialogHeader>
      <div className="flex items-center gap-3 text-start">
        <div className="size-14 shrink-0 rounded-lg overflow-hidden bg-muted flex items-center justify-center">{thumb}</div>
        <div className="min-w-0">
          <DialogTitle className="text-base leading-snug break-words flex items-center gap-2">
            <span className="min-w-0 break-words">{name}</span>
            {version && version > 1 && <Badge variant="secondary" className="text-[9px] shrink-0">{t('files.status.vVersion', { version })}</Badge>}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
    </DialogHeader>
  );
}

// ── file ───────────────────────────────────────────────────
function FileInfo({ file, location }: { file: FileLike; location?: string }) {
  const t = useT();
  const ext = extOf(file.name).toUpperCase();
  const thumb = isImage(file.name)
    ? <FilePreviewImage fileId={file.id} fileName={file.name} size={128} className="w-full h-full object-cover" fallback={<span className="font-mono text-[10px] font-bold" style={{ color: colorFor(file.name) }}>{ext || 'FILE'}</span>} />
    : <img src={fileIconSrc(file.name)} alt="" className="size-8" />;

  return (
    <>
      <Header thumb={thumb} name={file.name} version={file.current_version}
        subtitle={t('files.label.filemimeTypeunknownFilesizeBytes', { fileMime_typeUnknown: file.mime_type || t('files.label.unknownType'), fileSize_bytes: humanSize(file.size_bytes) })} />
      <div className="divide-y">
        <Row label={t('files.label.kind')}>{file.mime_type || t('common.label.unknown')}{ext ? ` (.${ext.toLowerCase()})` : ''}</Row>
        <Row label={t('common.label.size')}>{humanSize(file.size_bytes)} <span className="text-muted-foreground">{t('files.label.sizebytesBytes', { sizeBytes: formatNumber(file.size_bytes) })}</span></Row>
        {location && <Row label={t('common.label.where')}>{location}</Row>}
        <Row label={t('common.label.created')}>{fullDate(file.created_at)}</Row>
        <Row label={t('common.label.modified')}>{fullDate(file.updated_at)}</Row>
        <Row label={t('common.label.versions')}>{t('files.label.versions', { count: file.current_version })}</Row>
        <Row label={t('common.label.uploadedBy')}>{file.uploader_name || '-'}</Row>
        <Row label={t('common.label.region')}>{regionLabel(file.region)}</Row>
        <Row label={t('common.label.sharing')}>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><Share2 className="size-3.5 text-muted-foreground" /> {t('files.label.shares', { count: file.share_count })}</span>
            <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5 text-muted-foreground" /> {t('files.label.commentsLowercase', { count: file.comment_count })}</span>
          </span>
        </Row>
        <Row label={t('common.column.status')}><StatusBadges lock_mode={file.lock_mode} is_hidden={file.is_hidden} /></Row>
        <Row label={t('files.label.id')}><CopyableId id={file.id} /></Row>
      </div>
    </>
  );
}

// ── folder ─────────────────────────────────────────────────
function FolderInfo({ folder, location }: { folder: FolderLike; location?: string }) {
  const t = useT();
  return (
    <>
      <Header thumb={<img src={folderIconSrc(folder.file_count)} alt="" className="size-9" />} name={folder.name}
        subtitle={t('files.description.folderFolderfileCountPluralOneItemOtherItems', { folderFile_count: folder.file_count, folderTotal_size_bytes: humanSize(folder.total_size_bytes) })} />
      <div className="divide-y">
        <Row label={t('files.label.kind')}>{t('common.label.folder')}</Row>
        <Row label={t('files.label.items')}>{t('welcome.action.countPluralOneItemOtherItems', { count: folder.file_count })}</Row>
        <Row label={t('common.label.size')}>{humanSize(folder.total_size_bytes)} <span className="text-muted-foreground">{t('files.label.sizebytesBytes', { sizeBytes: formatNumber(folder.total_size_bytes) })}</span></Row>
        {location && <Row label={t('common.label.where')}>{location}</Row>}
        <Row label={t('common.label.created')}>{fullDate(folder.created_at)}</Row>
        <Row label={t('common.label.modified')}>{fullDate(folder.content_updated_at)}</Row>
        {folder.uploader_name != null && <Row label={t('files.label.createdBy')}>{folder.uploader_name || '-'}</Row>}
        <Row label={t('common.label.region')}>{folder.region ? regionLabel(folder.region) : '-'}</Row>
        <Row label={t('common.column.status')}><StatusBadges lock_mode={folder.lock_mode} is_hidden={folder.is_hidden} /></Row>
        <Row label={t('files.label.id')}><CopyableId id={folder.id} /></Row>
      </div>
    </>
  );
}

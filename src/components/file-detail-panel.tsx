import { useState, useEffect, useCallback } from 'react';
import { api, API_BASE, ApiError, apiErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  X, Download, Copy, Trash2, Eye, Share2, Lock,
  RotateCcw, Loader2, SquarePen,
} from 'lucide-react';
import { humanSize, timeAgo, expiryLabel, extOf, isImage, isVideo, isText, isAudio, fileIconSrc, regionLabel, colorFor, isOfficeFile } from '@/lib/helpers';
import { FilePreviewImage } from '@/components/file-preview-image';
import { OfficePreview } from '@/components/office-preview';
import { DosyaVideo } from '@dosya-dev/video-player/react';
import '@dosya-dev/video-player/skin.css';
import { toast } from '@/lib/toast';
import { IMPORT_SOURCE_LABELS } from '@/lib/cloud-providers';
import { useT } from '@/lib/i18n';
import { videoLabels } from '@/components/video/video-labels';


interface FileItem {
  id: string; name: string; size_bytes: number; mime_type: string; extension: string;
  region: string; created_at: number; updated_at: number; current_version: number;
  lock_mode: string; is_hidden: number; uploaded_by: string; uploader_name: string;
  share_count: number; comment_count: number; is_synced: number;
  import_source?: string; import_account_email?: string;
}

interface Version {
  id: string;
  version_number: number;
  size_bytes: number;
  mime_type: string;
  extension: string | null;
  uploaded_by: string;
  created_at: number;
  uploader_name: string | null;
}

interface ShareLink {
  id: string;
  url: string;
  view_count: number;
  download_count: number;
  expires_at: number | null;
  is_password_protected: number;
  is_revoked: number;
  created_at: number;
}

interface FileDetailPanelProps {
  file: FileItem | null;
  onClose: () => void;
  // Each of these is passed only when the role can perform it, and the button
  // is hidden when it is absent - the same contract the viewer overlay's
  // `actions` has. Before, every role saw all four and learned from the 403.
  onDownload?: (id: string) => void;
  onCopy?: (id: string) => void;
  onDelete?: (id: string, name: string) => void;
  onShare?: (id: string, name: string) => void;
  onView: (id: string, name: string) => void;
  onRefresh: () => void;
}

export function FileDetailPanel({ file, onClose, onDownload, onCopy, onDelete, onShare, onView, onRefresh }: FileDetailPanelProps) {
  const t = useT();
  const [versions, setVersions] = useState<Version[]>([]);
  const [currentVersion, setCurrentVersion] = useState(1);
  const [restoringVer, setRestoringVer] = useState<number | null>(null);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [lockPassword, setLockPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([]);
  const [revokingLink, setRevokingLink] = useState<string | null>(null);

  const loadVersions = useCallback(async (fileId: string) => {
    try {
      const data = await api<{
        ok: boolean; current_version: number;
        versions: Version[];
      }>(`/api/files/${fileId}/versions`);
      if (data.ok && data.versions && data.versions.length > 1) {
        setVersions(data.versions);
        setCurrentVersion(data.current_version);
      } else {
        setVersions([]);
      }
    } catch {
      setVersions([]);
    }
  }, []);

  const loadShareLinks = useCallback(async (fileId: string) => {
    try {
      const data = await api<{ ok: boolean; links?: ShareLink[] }>(`/api/files/${fileId}/share`);
      if (data.ok && data.links) setShareLinks(data.links.filter((l) => !l.is_revoked));
      else setShareLinks([]);
    } catch { setShareLinks([]); }
  }, []);

  const revokeShareLink = async (linkId: string) => {
    setRevokingLink(linkId);
    try {
      await api(`/api/shares/${linkId}/revoke`, { method: 'POST' });
      if (file) loadShareLinks(file.id);
      onRefresh();
    } catch { toast.error(t('common.error.revokeFailed'), t('common.error.theShareLinkCouldNotBeRevoked')); }
    setRevokingLink(null);
  };

  useEffect(() => {
    if (!file) return;
    setVersions([]);
    setShareLinks([]);
    setUnlockToken(null);
    setLockPassword('');
    setLockError('');
    if (file.lock_mode !== 'full_lock') {
      loadVersions(file.id);
      loadShareLinks(file.id);
    }
  }, [file?.id, file?.lock_mode, loadVersions, loadShareLinks]);

  const handleRestore = async (fileId: string, versionNumber: number) => {
    setRestoringVer(versionNumber);
    try {
      const res = await api<{ ok: boolean; error?: string }>(`/api/files/${fileId}/versions/restore`, {
        method: 'POST',
        body: JSON.stringify({ version_number: versionNumber }),
      });
      if (res.ok) {
        toast.success(t('common.feedback.restored'), t('common.feedback.restoredToVVersionnumber', { versionNumber }));
        loadVersions(fileId);
        onRefresh();
      } else {
        toast.error(t('common.error.restoreFailed'), res.error ?? t('common.error.restoreFailed'));
      }
    } catch {
      toast.error(t('common.error.restoreFailed'), t('common.error.restoreFailed.restoreFailed'));
    }
    setRestoringVer(null);
  };

  const handleUnlock = async () => {
    if (!file || !lockPassword.trim()) return;
    setUnlocking(true);
    setLockError('');
    try {
      const res = await api<{ ok: boolean; error?: string; unlock_token?: string }>(`/api/files/${file.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ password: lockPassword }),
      });
      if (res.ok && res.unlock_token) {
        setUnlockToken(res.unlock_token);
        loadVersions(file.id);
      } else {
        setLockError(res.error ?? t('files.error.incorrectPassword'));
        setLockPassword('');
      }
    } catch (err) {
      // api() throws on non-2xx, so a rejected password lands here - surface
      // the server's message and reset the field like the else-branch does.
      setLockError(apiErrorMessage(err, t('common.error.canTReachTheServerCheckYourConnectionAnd')));
      if (err instanceof ApiError) setLockPassword('');
    }
    setUnlocking(false);
  };

  if (!file) return null;

  const isLocked = file.lock_mode === 'full_lock' && !unlockToken;
  const utSuffix = unlockToken ? `?ut=${unlockToken}` : '';

  return (
    <>
      {/* Mobile overlay */}
      <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-x-0 bottom-0 max-h-[80vh] z-50 bg-background border-t rounded-t-2xl shadow-xl flex flex-col overflow-hidden animate-mobile-slide-up lg:static lg:inset-auto lg:max-h-none lg:w-[280px] lg:shrink-0 lg:border-s lg:border-t-0 lg:rounded-none lg:shadow-none lg:z-auto lg:animate-panel-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <span className="text-sm font-semibold">{t('common.label.fileDetails')}</span>
          <button onClick={onClose} className="size-6 rounded-md flex items-center justify-center hover:bg-muted">
            <X className="size-3.5" />
          </button>
        </div>

        {/* Locked gate */}
        {isLocked ? (
          <div className="flex-1 overflow-y-auto">
            <div className="w-full h-28 bg-violet-500 flex items-center justify-center">
              <Lock className="size-7 text-white" />
            </div>
            <div className="p-4">
              <p className="text-sm font-semibold break-all mb-1"><bdi>{file.name}</bdi></p>
              <p className="text-xs text-muted-foreground mb-4">{t('files.label.thisFileIsLocked')}</p>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t('files.description.enterTheLockPasswordToAccessThisFile')}</p>
                {lockError && <div dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{lockError}</div>}
                <Input
                  type="password"
                  value={lockPassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLockPassword(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && handleUnlock()}
                  placeholder={t('files.placeholder.enterPassword')}
                  className="h-9 rounded-md px-3 text-sm bg-muted/30 dark:bg-muted/30"
                  autoFocus
                />
                <Button className="w-full" onClick={handleUnlock} disabled={unlocking}>
                  {unlocking ? <Loader2 className="size-4 animate-spin me-1.5" /> : <Lock className="size-3.5 me-1.5" />}
                  {t('common.action.unlock')}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Preview */}
            <FilePreview file={file} utSuffix={utSuffix} />

            {/* Body */}
            <div className="p-4 space-y-4">
              {/* Filename + version badge */}
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold break-all"><bdi>{file.name}</bdi></p>
                  {file.current_version > 1 && (
                    <Badge variant="secondary" className="text-[9px] shrink-0">{t('files.status.vFilecurrentVersion', { version: file.current_version })}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('files.label.filesizeBytesMiddotFilemimeTypeMiddotFilecreatedAt', { fileSize_bytes: humanSize(file.size_bytes), fileMime_type: file.mime_type, fileCreated_at: timeAgo(file.created_at) })}
                </p>
                {file.lock_mode === 'view_only' && (
                  <Badge variant="outline" className="text-[9px] mt-1 gap-1"><Lock className="size-2.5" /> {t('common.status.viewOnly')}</Badge>
                )}
              </div>

              {/* Version history */}
              {versions.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t('common.label.versions')}</span>
                    <Badge variant="secondary" className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">{t('files.status.vCurrentversion', { version: currentVersion })}</Badge>
                  </div>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {versions.map((v) => {
                      const isCurrent = v.version_number === currentVersion;
                      return (
                        <div key={v.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] ${isCurrent ? 'bg-green-50 dark:bg-green-950/30' : 'hover:bg-muted/50'}`}>
                          <span className={`font-bold min-w-5 ${isCurrent ? 'text-green-600' : ''}`}>{t('common.label.vVersion', { version: v.version_number })}</span>
                          <span className="flex-1 min-w-0 text-muted-foreground truncate">
                            {t('files.label.vsizeBytesMiddotVuploaderNameunknownMiddotVcreatedAt', { vSize_bytes: humanSize(v.size_bytes), vUploader_nameUnknown: v.uploader_name ?? t('common.label.unknown'), vCreated_at: timeAgo(v.created_at) })}
                          </span>
                          <div className="flex gap-1 shrink-0">
                            <a
                              href={`${API_BASE}/api/files/${file.id}/download?version=${v.version_number}`}
                              className="h-5 px-1.5 rounded border text-[9px] font-medium flex items-center hover:bg-muted"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Download className="size-2.5" />
                            </a>
                            {!isCurrent && (
                              <button
                                className="h-5 px-1.5 rounded border border-blue-200 text-blue-600 text-[9px] font-medium flex items-center hover:bg-blue-50 dark:border-blue-800 dark:hover:bg-blue-950"
                                onClick={() => handleRestore(file.id, v.version_number)}
                                disabled={restoringVer === v.version_number}
                              >
                                {restoringVer === v.version_number ? <Loader2 className="size-2.5 animate-spin" /> : <RotateCcw className="size-2.5 me-0.5" />}
                                {t('common.action.restore')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Properties */}
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">{t('common.label.properties')}</span>
                <div className="space-y-1.5">
                  <PropRow label={t('common.label.uploadedBy')} value={file.uploader_name ?? t('common.label.unknown')} />
                  <PropRow label={t('common.label.region')} value={regionLabel(file.region)} />
                  <PropRow label={t('common.label.created')} value={timeAgo(file.created_at)} />
                  <PropRow label={t('common.label.extension')} value={file.extension || extOf(file.name).toUpperCase() || '-'} />
                  {file.is_synced === 1 && <PropRow label={t('common.status.synced')} value={t('common.label.yes')} />}
                  {file.import_source && (
                    <>
                      <div className="border-t my-2" />
                      <PropRow
                        label={t('common.label.source')}
                        value={IMPORT_SOURCE_LABELS[file.import_source ?? ''] ?? file.import_source}
                      />
                      {file.import_account_email && <PropRow label={t('common.label.account')} value={file.import_account_email} />}
                    </>
                  )}
                </div>
              </div>

              {/* Share links */}
              {shareLinks.length > 0 && (
                <div>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block mb-2">{t('common.label.shareLinks')}</span>
                  <div className="space-y-2">
                    {shareLinks.map((link) => {
                      const now = Math.floor(Date.now() / 1000);
                      return (
                        <div key={link.id} className="bg-muted/30 border rounded-md px-2.5 py-2 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <span dir="ltr" className="text-[10px] font-mono text-muted-foreground truncate flex-1">{link.url}</span>
                            <button
                              className="text-[10px] font-semibold text-green-600 hover:text-green-700 shrink-0"
                              onClick={() => { navigator.clipboard.writeText(link.url); toast.success(t('common.label.linkCopied'), t('files.action.copiedToClipboard')); }}
                            >{t('common.copy')}</button>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="secondary" className="text-[8px] h-4">{t('files.status.linkviewCountViews', { viewCount: link.view_count })}</Badge>
                            <Badge variant="secondary" className="text-[8px] h-4">
                              {expiryLabel(link.expires_at, now)}
                            </Badge>
                            {link.is_password_protected === 1 && <Badge variant="secondary" className="text-[8px] h-4">{t('common.status.password')}</Badge>}
                          </div>
                          <button
                            className="text-[10px] font-medium text-destructive hover:underline"
                            onClick={() => revokeShareLink(link.id)}
                            disabled={revokingLink === link.id}
                          >
                            {revokingLink === link.id ? t('files.action.revoking') : t('common.action.revokeLink')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-1.5 pt-1">
                <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-10 text-xs" onClick={() => onView(file.id, file.name)}>
                  <Eye className="size-3.5 text-muted-foreground" /> {t('common.action.viewFile')}
                </Button>
                {onDownload && (
                  <Button size="sm" className="w-full justify-start gap-2 h-10 text-xs bg-green-500 hover:bg-green-600 text-white" onClick={() => onDownload(file.id)}>
                    <Download className="size-3.5" /> {t('common.action.download')}
                  </Button>
                )}
                {isOfficeFile(file.name) && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-10 text-xs" onClick={() => window.open(`/editor/${file.id}`, '_blank')}>
                    <SquarePen className="size-3.5 text-muted-foreground" /> {t('common.label.openInEditor')}
                  </Button>
                )}
                {onShare && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-10 text-xs" onClick={() => onShare(file.id, file.name)}>
                    <Share2 className="size-3.5 text-muted-foreground" /> {t('common.action.share')}
                  </Button>
                )}
                {onCopy && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-10 text-xs" onClick={() => onCopy(file.id)}>
                    <Copy className="size-3.5 text-muted-foreground" /> {t('files.action.copyFile')}
                  </Button>
                )}
                {onDelete && (
                  <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-10 text-xs text-destructive border-destructive/30 hover:bg-destructive/5" onClick={() => onDelete(file.id, file.name)}>
                    <Trash2 className="size-3.5" /> {t('files.action.deleteFile')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function FilePreview({ file, utSuffix }: { file: FileItem; utSuffix: string }) {
  const t = useT();
  const [previewError, setPreviewError] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);

  useEffect(() => {
    setPreviewError(false);
    setTextContent(null);
    if (isText(file.name)) {
      fetch(`${API_BASE}/api/files/${file.id}/raw${utSuffix}`, { credentials: 'include' })
        .then((r) => r.ok ? r.text() : Promise.reject())
        .then((body) => setTextContent(body.slice(0, 2000)))
        .catch(() => setPreviewError(true));
    }
  }, [file.id, file.name, utSuffix]);

  if (previewError || (!isImage(file.name) && !isVideo(file.name) && !file.name.toLowerCase().endsWith('.pdf') && !isText(file.name) && !isAudio(file.name) && !isOfficeFile(file.name))) {
    const ext = extOf(file.name).toUpperCase() || t('files.alternative.file');
    return (
      <div className="w-full h-28 flex items-center justify-center" style={{ background: colorFor(file.name) + '18' }}>
        <img src={fileIconSrc(file.name)} alt={ext} className="size-16" />
      </div>
    );
  }

  if (isImage(file.name)) {
    return (
      <div className="w-full h-28 bg-muted/50 flex items-center justify-center overflow-hidden">
        <FilePreviewImage
          fileId={file.id}
          fileName={file.name}
          query={utSuffix.replace(/^\?/, '')}
          size={512}
          className="w-full h-full object-contain"
          alt={file.name}
          fallback={
            <div className="w-full h-28 flex items-center justify-center" style={{ background: colorFor(file.name) + '18' }}>
              <img src={fileIconSrc(file.name)} alt={extOf(file.name).toUpperCase() || t('files.alternative.file')} className="size-16" />
            </div>
          }
        />
      </div>
    );
  }

  if (isVideo(file.name)) {
    return (
      <div className="w-full h-48 bg-black flex items-center justify-center overflow-hidden">
        {/* The shared player in compact mode: keys only while it has focus, so
            it never takes arrows or Space from the file list. A failure shows
            the panel's own icon fallback below instead of the player's card. */}
        <DosyaVideo
          identity={`${file.id}:${utSuffix}`}
          src={`${API_BASE}/api/files/${file.id}/raw${utSuffix}`}
          className="flex h-full w-full items-center justify-center"
          compact
          preload="metadata"
          autoplay={false}
          failureText=""
          labels={videoLabels(t)}
          downloadUrl={null}
          title={file.name}
          onFailed={() => setPreviewError(true)}
        />
      </div>
    );
  }

  if (file.name.toLowerCase().endsWith('.pdf')) {
    return (
      <div className="w-full h-48 bg-muted/50 overflow-hidden">
        <iframe
          src={`${API_BASE}/api/files/${file.id}/raw${utSuffix}#toolbar=0&navpanes=0`}
          className="w-full h-full border-none"
          title={t('files.tooltip.pdfPreviewOfFileName', { fileName: file.name })}
        />
      </div>
    );
  }

  if (isAudio(file.name)) {
    return (
      <div className="w-full h-20 bg-muted/30 flex items-center justify-center px-4">
        <audio src={`${API_BASE}/api/files/${file.id}/raw${utSuffix}`} controls className="w-full h-10" preload="metadata" />
      </div>
    );
  }

  if (isText(file.name)) {
    return (
      <div className="w-full h-40 bg-[#1e1e1e] overflow-hidden">
        <pre className="m-0 p-3 text-[11px] leading-relaxed text-[#d4d4d4] font-mono whitespace-pre-wrap break-all h-full overflow-hidden">
          {textContent ?? t('common.status.loading')}
        </pre>
      </div>
    );
  }

  if (isOfficeFile(file.name)) {
    return (
      <div className="w-full h-48 bg-muted/50 overflow-hidden">
        <OfficePreview
          file={file}
          compact
          fallback={
            <div className="w-full h-28 flex items-center justify-center" style={{ background: colorFor(file.name) + '18' }}>
              <img src={fileIconSrc(file.name)} alt={extOf(file.name).toUpperCase() || t('files.alternative.file')} className="size-16" />
            </div>
          }
        />
      </div>
    );
  }

  return null;
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium truncate max-w-32 text-end" dir="auto">{value}</span>
    </div>
  );
}

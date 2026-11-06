import { useEffect, useId, useMemo, useState, type JSX } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, EyeOff, FolderOpen, Loader2, Lock, RefreshCw } from 'lucide-react';
import { api, apiErrorMessage, ApiError } from '@/api/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { useSession, type SessionWorkspace } from '@/stores/session';
import { useWorkspace } from '@/stores/workspace';
import { queryClient } from '@/lib/query-client';
import { FILES_QUERY_ROOT } from '@/lib/files-request';
import { LIBRARY_QUERY_ROOT } from '@/lib/library-request';
import { fileIconSrc, folderIconSrc, humanSize } from '@/lib/helpers';
import { sharePageUrl } from '@/lib/site-origin';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import type { T } from '@/i18n/translator';
import { cn } from '@/lib/utils';

/** The slice of GET /api/share/:token this page reads. */
export interface SharePreview {
  ok: boolean;
  requires_recipient_verification?: boolean;
  is_password_protected?: boolean | number;
  is_gallery?: boolean;
  is_bundle?: boolean;
  is_folder?: boolean;
  lock_mode?: string;
  folder?: { root_id: string; root_name: string; subfolders?: { id: string; name: string }[] };
  gallery?: { title: string; item_count: number };
  files: { id: string; name: string; size_bytes: number; uploader_name?: string | null }[];
  link?: { downloads_left?: number | null; title?: string | null; message?: string | null };
}

/** POST /api/share/:token/save, 201. */
export interface SaveShareResult {
  ok: boolean;
  workspace_id: string;
  folder_id: string | null;
  saved: { file_id: string; name: string; size_bytes: number }[];
  skipped: { name: string; reason: string }[];
}

type Permissions = { permissions?: Record<string, boolean>; root_folder_id?: string | null; root_folder_name?: string | null };

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: SharePreview };

/** name is empty for the workspace root and for a confined member's unnamed folder; both are named at render time. */
type Dest = { id: string | null; name: string };
const ROOT: Dest = { id: null, name: '' };

function isGated(d: SharePreview): boolean {
  if (d.requires_recipient_verification) return true;
  return !!d.is_password_protected && d.files.length === 0 && !d.folder && !d.gallery;
}

/** What the share holds, in the words the page leads with. */
function describe(d: SharePreview, selected: string[], t: T): { title: string; detail: string; icon: string } {
  const sender = d.files.find((f) => f.uploader_name)?.uploader_name;
  const by = sender ? t('save-share.label.sharedByName', { name: sender }) : '';
  const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
  const picked = selected.length ? d.files.filter((f) => selected.includes(f.id)) : [];

  if (d.is_gallery && d.gallery) {
    return { title: d.gallery.title, detail: join(t('integrations-lightroom.label.photos', { count: d.gallery.item_count }), by), icon: folderIconSrc(d.gallery.item_count) };
  }
  if (d.folder) {
    if (selected.length) {
      return { title: t('save-share.label.selectedFiles', { count: selected.length }), detail: join(t('save-share.label.fromName', { name: d.folder.root_name }), by), icon: folderIconSrc(selected.length) };
    }
    const subs = d.folder.subfolders?.length ?? 0;
    const top = subs || d.files.length
      ? t('save-share.label.topLevelContents', { folders: subs, files: d.files.length, both: subs && d.files.length ? 'true' : 'other' })
      : t('save-share.label.emptyFolder');
    return { title: d.folder.root_name, detail: join(top, by), icon: folderIconSrc(subs + d.files.length) };
  }
  const files = picked.length ? picked : d.files;
  const size = humanSize(files.reduce((sum, f) => sum + (f.size_bytes || 0), 0));
  if (files.length === 1) return { title: files[0]!.name, detail: join(size, by), icon: fileIconSrc(files[0]!.name) };
  return { title: picked.length ? t('save-share.label.selectedFiles', { count: files.length }) : t('save-share.label.files', { count: files.length }), detail: join(size, by), icon: folderIconSrc(files.length) };
}

/**
 * /save/:token - "Save to dosya" for a share someone sent you. The share page's
 * dock links here. Inside the dashboard layout, so a signed-out visitor goes
 * through login (or sign-up, verify and the tour) and is brought back by
 * lib/post-auth-path.ts. `?ids=a,b` carries a selection made on the share page.
 */
export default function SaveSharePage() {
  const t = useT();
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const selectId = useId();
  const selected = useMemo(
    () => (params.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    [params],
  );

  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const workspaces = useSession((s) => s.workspaces);
  const activeId = useWorkspace((s) => s.activeId);
  const [chosenWs, setChosenWs] = useState('');
  const wsId = chosenWs
    || (workspaces?.some((w) => w.id === activeId) ? activeId : workspaces?.[0]?.id ?? '');
  // Keyed by workspace so a switch reads as "not known yet" without a reset.
  const [permsFor, setPermsFor] = useState<{ ws: string; perms: Permissions } | null>(null);
  const perms = permsFor?.ws === wsId ? permsFor.perms : null;
  const [dest, setDest] = useState<Dest>(ROOT);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<SharePreview>(`/api/share/${encodeURIComponent(token)}`)
      .then((data) => { if (!cancelled) setLoad({ kind: 'ready', data: { ...data, files: data.files ?? [] } }); })
      .catch((e) => {
        if (cancelled) return;
        const gone = e instanceof ApiError && (e.status === 404 || e.status === 410);
        setLoad({
          kind: 'error',
          message: gone
            ? t('save-share.error.linkExpired')
            : apiErrorMessage(e, t('save-share.error.couldNotOpenThisLink')),
        });
      });
    return () => { cancelled = true; };
  }, [token, attempt]);

  // The boot gate has normally loaded the list already; this covers a list
  // that failed at boot.
  useEffect(() => {
    if (workspaces === null) void useSession.getState().fetchWorkspaces().catch(() => {});
  }, [workspaces]);

  // The chosen workspace's own permissions: whether this role can add files,
  // and the folder a confined member must save under.
  useEffect(() => {
    if (!wsId) return;
    let cancelled = false;
    api<Permissions>(`/api/me/permissions?workspace_id=${encodeURIComponent(wsId)}`)
      .then((p) => {
        if (cancelled) return;
        setPermsFor({ ws: wsId, perms: p });
        setDest(p.root_folder_id ? { id: p.root_folder_id, name: p.root_folder_name || '' } : ROOT);
      })
      .catch(() => { if (!cancelled) { setPermsFor({ ws: wsId, perms: {} }); setDest(ROOT); } });
    return () => { cancelled = true; };
  }, [wsId]);

  const workspace: SessionWorkspace | undefined = workspaces?.find((w) => w.id === wsId);
  const wsName = workspace?.name ?? 'dosya';
  const cannotUpload = perms?.permissions ? perms.permissions.upload_files === false : false;

  const data = load.kind === 'ready' ? load.data : null;
  const info = data && !isGated(data) ? describe(data, selected, t) : null;

  const save = async () => {
    if (!wsId) return;
    setSaving(true);
    setError('');
    try {
      const res = await api<SaveShareResult>(`/api/share/${encodeURIComponent(token)}/save`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: wsId,
          folder_id: dest.id,
          ...(selected.length ? { file_ids: selected } : {}),
        }),
      });
      if (!res.saved.length) {
        const why = res.skipped[0];
        setError(why ? t('save-share.error.nothingWasSavedNameReason', { name: why.name, reason: why.reason }) : t('save-share.error.nothingWasSavedNoFiles'));
        setSaving(false);
        return;
      }
      queryClient.invalidateQueries({ queryKey: [FILES_QUERY_ROOT, res.workspace_id] });
      queryClient.invalidateQueries({ queryKey: [LIBRARY_QUERY_ROOT, res.workspace_id] });
      const firstSkipped = res.skipped[0];
      toast.success(
        t('save-share.feedback.savedToName', { name: wsName }),
        t('save-share.feedback.filesSavedSkipped', { saved: res.saved.length, skipped: res.skipped.length, name: firstSkipped?.name ?? '', reason: firstSkipped?.reason ?? '' }),
      );
      useWorkspace.getState().setActiveId(res.workspace_id);
      navigate(res.folder_id ? `/files?folder=${encodeURIComponent(res.folder_id)}` : '/files');
    } catch (e) {
      setError(apiErrorMessage(e, t('save-share.error.couldNotReachDosya')));
      setSaving(false);
    }
  };

  let body: JSX.Element;
  if (load.kind === 'loading') {
    body = (
      <div aria-busy="true" aria-label={t('save-share.label.loadingTheSharedLink')} className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-md" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  } else if (load.kind === 'error') {
    body = (
      <>
        <AlertCircle className="size-8 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">{t('save-share.heading.thisLinkCannotBeOpened')}</h1>
        <p dir="auto" className="text-sm text-muted-foreground">{load.message}</p>
        <Button variant="outline" className="h-10" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((n) => n + 1); }}>
          <RefreshCw className="size-4" /> {t('common.action.tryAgain')}
        </Button>
      </>
    );
  } else if (isGated(load.data)) {
    body = (
      <>
        <Lock className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold">{t('save-share.heading.openTheLinkAndUnlockItFirst')}</h1>
        <p className="text-sm text-muted-foreground">
          {load.data.requires_recipient_verification
            ? t('save-share.description.invitedPeopleOnly')
            : t('save-share.description.asksForAPassword')}
        </p>
        <a href={sharePageUrl(token)} className={cn(buttonVariants(), 'h-10')}>{t('save-share.action.openTheSharePage')}</a>
      </>
    );
  } else if (load.data.lock_mode === 'view_only' || load.data.lock_mode === 'full_lock') {
    body = (
      <>
        <Preview info={info!} />
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-3">
          <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t('save-share.heading.theSenderTurnedOffDownloads')}</h2>
            <p className="text-sm text-muted-foreground">{t('save-share.description.viewOnly')}</p>
          </div>
        </div>
        <a href={sharePageUrl(token)} className={cn(buttonVariants({ variant: 'outline' }), 'h-10')}>{t('save-share.action.openTheSharePage')}</a>
      </>
    );
  } else if (load.data.link?.downloads_left === 0) {
    body = (
      <>
        <Preview info={info!} />
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 px-3 py-3">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t('save-share.heading.noDownloadsLeft')}</h2>
            <p className="text-sm text-muted-foreground">{t('save-share.description.noDownloadsLeft')}</p>
          </div>
        </div>
      </>
    );
  } else {
    const d = load.data;
    const noWorkspace = workspaces !== null && workspaces.length === 0;
    body = (
      <>
        <Preview info={info!} />
        {(d.link?.title || d.link?.message) && (
          <div className="w-full rounded-lg border px-3 py-3 space-y-1">
            {d.link?.title && <p dir="auto" className="text-sm font-semibold break-words">{d.link.title}</p>}
            {d.link?.message && <p dir="auto" className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{d.link.message}</p>}
          </div>
        )}
        <div className="w-full space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={selectId} className="text-sm font-medium">{t('common.label.workspace')}</label>
            <select
              id={selectId}
              value={wsId}
              onChange={(e) => { setChosenWs(e.target.value); setError(''); }}
              disabled={saving || !workspaces?.length}
              className="h-10 w-full rounded-md border bg-background px-2 text-sm"
            >
              {(workspaces ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            {cannotUpload && (
              <p role="alert" className="text-xs text-destructive">
                {t('save-share.description.roleCannotAddFiles', { name: wsName })}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium" id={`${selectId}-folder`}>{t('common.label.folder')}</span>
            <div className="flex items-center gap-2">
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm" aria-labelledby={`${selectId}-folder`}>
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{dest.name || (dest.id ? t('save-share.label.yourFolder') : t('common.label.rootTopLevel'))}</span>
              </div>
              <Button variant="outline" className="h-10" onClick={() => setPickerOpen(true)} disabled={saving || !wsId || cannotUpload}>
                {t('profile.action.change')}
              </Button>
            </div>
            {d.folder && (
              <p className="text-xs text-muted-foreground">{t('save-share.description.newFolderCreatedHere', { name: d.folder.root_name })}</p>
            )}
          </div>
        </div>
        {noWorkspace && (
          <p role="alert" className="text-sm text-destructive">{t('save-share.error.noWorkspace')}</p>
        )}
        {error && <p dir="auto" role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <a href={sharePageUrl(token)} className={cn(buttonVariants({ variant: 'ghost' }), 'h-10')}>{t('save-share.action.backToTheSharePage')}</a>
          <Button className="h-10" onClick={() => void save()} disabled={saving || !wsId || cannotUpload || perms === null}>
            {saving ? <><Loader2 className="size-4 animate-spin" aria-hidden /> {t('save-share.action.savingToName', { name: wsName })}</> : t('save-share.action.saveToName', { name: wsName })}
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">{saving ? t('save-share.action.savingToName', { name: wsName }) : ''}</p>
        {wsId && (
          <FolderPickerDialog
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            workspaceId={wsId}
            selectedId={dest.id}
            selectedName={dest.id ? dest.name : ''}
            title={t('save-share.heading.saveToAFolderInName', { name: wsName })}
            confirmLabel={t('save-share.action.useThisFolder')}
            onSelect={(id, name) => { setDest(id ? { id, name } : ROOT); setPickerOpen(false); }}
          />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 sm:py-10">
      <Card className="flex flex-col items-start gap-4 p-5 sm:p-6">{body}</Card>
    </div>
  );
}

function Preview({ info }: { info: { title: string; detail: string; icon: string } }) {
  const t = useT();
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <img src={info.icon} alt="" className="size-10 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t('common.action.saveToDosya')}</p>
        <h1 className="truncate text-base font-semibold" title={info.title}>{info.title}</h1>
        {info.detail && <p className="truncate text-sm text-muted-foreground">{info.detail}</p>}
      </div>
    </div>
  );
}

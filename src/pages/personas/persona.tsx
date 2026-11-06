// One persona (Persona.dc.html): cover, name (rename inline), photo count,
// Change cover / Merge with… / Remove person, and the photos newest first in
// month sections. Each photo has a menu: "Not <name>", "Set as cover",
// "Show in folder".
//
// Everything comes from this device's engine: the persona and its photos
// (with the face id of this persona in each) from engine.personaPhotos, and
// every action is journaled for the user's other devices. The file names,
// dates and folders come from the photo listing the engine reads from
// (personasPhotoRows); a photo missing there is not readable any more
// (trashed, hidden, locked) and leaves the persona on the next read, so it
// is not shown.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, EllipsisVertical, GitMerge, ImageIcon, Loader2, Pencil, Plus, Settings, UserRoundX } from 'lucide-react';
import type { PersonasEngine } from '@dosya-dev/personas-engine';
import { FileViewer } from '@/components/file-viewer';
import { FilePreviewImage } from '@/components/file-preview-image';
import { FaceAvatar } from '@/components/personas/face-avatar';
import { MergeDialog } from '@/components/personas/merge-dialog';
import { PersonaNameField } from '@/components/personas/name-field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { FileItem } from '@/lib/file-types';
import { formatDateWith, localDigits } from '@/lib/format-locale';
import { useT } from '@/lib/i18n';
import { personaHref, type FaceBox, type PersonaCard } from '@/lib/personas';
import { personasPhotoRows, type PhotoRow } from '@/lib/personas-device/engine-host';
import type { ReadyStatus } from '@/lib/personas-progress';
import { richText } from '@/lib/rich-text';
import { toast } from '@/lib/toast';

/** Photos per "Load more". */
const PAGE = 60;
/** The engine's largest page. */
const ENGINE_PAGE_MAX = 500;

type Photo = { file: PhotoRow; face_id: string; box: FaceBox };

type Page = { state: 'ready'; persona: PersonaCard; faces: { file_id: string; face_id: string; box: FaceBox }[]; more: boolean } | { state: 'gone' };

/** The persona and its first `count` photos (the engine pages by cursor). */
function readPage(engine: Pick<PersonasEngine, 'personaPhotos'>, pid: string, count: number): Page {
  try {
    let cursor: string | null = null;
    let persona: PersonaCard | null = null;
    const faces: { file_id: string; face_id: string; box: FaceBox }[] = [];
    do {
      const p = engine.personaPhotos(pid, cursor, Math.min(ENGINE_PAGE_MAX, count - faces.length));
      persona = p.persona;
      faces.push(...p.files);
      cursor = p.next;
    } while (cursor && faces.length < count);
    return { state: 'ready', persona: persona!, faces, more: cursor !== null };
  } catch {
    return { state: 'gone' };
  }
}

/** The viewer wants a full file row; the listing's rows carry the file fields. */
function toFileItem(r: PhotoRow): FileItem {
  return {
    id: r.id, name: r.name ?? '', size_bytes: r.size_bytes ?? 0, mime_type: r.mime_type ?? '', extension: r.extension ?? '',
    region: r.region ?? '', created_at: r.created_at ?? 0, updated_at: r.updated_at ?? r.created_at ?? 0,
    current_version: r.current_version ?? 1, lock_mode: r.lock_mode ?? 'none', is_hidden: r.is_hidden ?? 0,
    uploaded_by: r.uploaded_by ?? '', uploader_name: '', share_count: 0, comment_count: 0, is_synced: 0, folder_id: r.folder_id,
  } as FileItem;
}

const dateOf = (r: PhotoRow) => Number(r.taken_at ?? r.created_at ?? 0);

/** Year-month key in the viewer's own time zone. */
const monthKey = (unix: number) => { const d = new Date(unix * 1000); return `${d.getFullYear()}-${d.getMonth()}`; };

export function PersonaView({ wsId, personaId, engine, status }: {
  wsId: string;
  personaId: string;
  engine: PersonasEngine;
  /** The engine's status: a new object after every change, so the page reads the engine again. */
  status?: ReadyStatus;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [count, setCount] = useState(PAGE);
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [pickingCover, setPickingCover] = useState(false);
  const [viewing, setViewing] = useState<FileItem | null>(null);
  // Bumped after an action, so the page reads the engine again even when no status change follows.
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<ReadonlyMap<string, PhotoRow> | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- status and version are change signals
  const page = useMemo(() => readPage(engine, personaId, count), [engine, personaId, count, status, version]);

  // The listing is cached for a few minutes and shared with the engine; the
  // same Map comes back until it is made again.
  useEffect(() => {
    let cancelled = false;
    personasPhotoRows(wsId).then(
      (r) => { if (!cancelled) setRows((prev) => (prev === r ? prev : r)); },
      () => { if (!cancelled) setRows((prev) => prev ?? new Map()); },
    );
    return () => { cancelled = true; };
  }, [wsId, status]);

  const photos = useMemo<Photo[]>(() => {
    if (page.state !== 'ready' || !rows) return [];
    const out: Photo[] = [];
    for (const f of page.faces) {
      const file = rows.get(f.file_id);
      if (file) out.push({ file, face_id: f.face_id, box: f.box });
    }
    return out;
  }, [page, rows]);

  const months = useMemo(() => {
    const out: { key: string; label: string; photos: Photo[] }[] = [];
    for (const p of photos) {
      const at = dateOf(p.file);
      const key = monthKey(at);
      let m = out.find((x) => x.key === key);
      if (!m) { m = { key, label: formatDateWith(at, { month: 'long', year: 'numeric' }), photos: [] }; out.push(m); }
      m.photos.push(p);
    }
    return out;
  }, [photos]);

  if (page.state === 'gone') {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <BackLink />
        <p role="alert" className="mt-6 text-sm text-muted-foreground">{t('personas.error.personaIsNoLongerHere')}</p>
      </div>
    );
  }

  const { persona } = page;
  const name = persona.name;
  const changed = () => setVersion((v) => v + 1);

  const perform = async (run: () => Promise<unknown>) => {
    try {
      await run();
      changed();
    } catch {
      toast.error(t('personas.error.couldNotUpdatePersona'));
    }
  };
  const notThis = (p: Photo) => perform(() => engine.notThisPerson(p.face_id));
  const makeCover = (p: Photo) => {
    setPickingCover(false);
    return perform(() => engine.setCover(persona.id, p.face_id));
  };

  const remove = async () => {
    setRemoving(true);
    try {
      await engine.removePersona(persona.id);
      setRemoveOpen(false);
      navigate('/personas');
    } catch {
      toast.error(t('personas.error.couldNotUpdatePersona'));
    } finally {
      setRemoving(false);
    }
  };

  const fileItems = photos.map((p) => toFileItem(p.file));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <Link to="/personas/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <Settings aria-hidden="true" />
          {t('personas.action.personasSettings')}
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <FaceAvatar fileId={persona.cover_file_id} box={persona.cover_box} name={name} className="size-20" />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <PersonaNameField
              engine={engine}
              personaId={persona.id}
              initial={name ?? ''}
              onSaved={() => { setRenaming(false); changed(); }}
              onCancel={() => setRenaming(false)}
              className="max-w-xs"
            />
          ) : (
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-xl font-semibold tracking-tight truncate" dir="auto">{name ?? t('personas.label.unnamed')}</h1>
              <button
                type="button"
                onClick={() => setRenaming(true)}
                aria-label={name ? t('personas.action.renameName', { name }) : t('personas.action.addAName')}
                title={name ? t('common.action.rename') : t('personas.action.addAName')}
                className="size-7 shrink-0 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {name ? <Pencil className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              </button>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{t('personas.label.photoCount', { count: persona.photo_count })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setPickingCover((v) => !v)} aria-pressed={pickingCover}>
            <ImageIcon aria-hidden="true" /> {t('personas.action.changeCover')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMerging(true)}>
            <GitMerge aria-hidden="true" /> {t('personas.action.mergeWith')}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setRemoveOpen(true)}>
            <UserRoundX aria-hidden="true" /> {t('personas.action.removePerson')}
          </Button>
        </div>
      </div>

      {pickingCover && (
        <div role="status" className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/50 px-3.5 py-2 text-sm">
          <span className="flex-1">{t('personas.description.pickAPhotoForTheCover')}</span>
          <Button variant="ghost" size="sm" onClick={() => setPickingCover(false)}>{t('common.cancel')}</Button>
        </div>
      )}

      {!rows && (
        <div className="flex justify-center py-16" role="status" aria-label={t('common.status.loading')}>
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      {rows && photos.length === 0 && <p className="mt-8 text-sm text-muted-foreground">{t('personas.description.noPhotosToShow')}</p>}

      {months.map((m) => (
        <section key={m.key} aria-labelledby={`month-${m.key}`} className="mt-8">
          <h2 id={`month-${m.key}`} className="text-sm font-semibold mb-3">
            {m.label}<span className="font-normal text-muted-foreground"> · {localDigits(m.photos.length)}</span>
          </h2>
          <ul className="grid gap-1.5 grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]">
            {m.photos.map((p) => (
              <PhotoTile
                key={p.file.id}
                file={p.file}
                personaName={name}
                picking={pickingCover}
                onOpen={() => (pickingCover ? void makeCover(p) : setViewing(toFileItem(p.file)))}
                onNotThis={() => void notThis(p)}
                onCover={() => void makeCover(p)}
                onShowInFolder={() => navigate(`/files?file=${encodeURIComponent(p.file.id)}${p.file.folder_id ? `&folder=${encodeURIComponent(p.file.folder_id)}` : ''}`)}
              />
            ))}
          </ul>
        </section>
      ))}

      {page.more && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setCount((c) => c + PAGE)}>{t('common.action.loadMore')}</Button>
        </div>
      )}

      <MergeDialog
        open={merging}
        engine={engine}
        target={persona}
        onClose={() => setMerging(false)}
        onMerged={(survivor) => {
          setMerging(false);
          changed();
          if (survivor !== persona.id) navigate(personaHref(survivor));
        }}
      />

      <Dialog open={removeOpen} onOpenChange={(o) => { if (!removing) setRemoveOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('common.heading.areYouSure')}</DialogTitle>
            <DialogDescription className="break-words">
              {name
                ? richText(t('personas.description.youAreRemovingNameTheirFaceDataIsDeleted'), { name: <strong className="font-semibold text-foreground"><bdi>{name}</bdi></strong> })
                : t('personas.description.youAreRemovingThisPersonTheirFaceDataIsDeleted')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)} disabled={removing}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={removing}>{t('personas.action.removePerson')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewing && (
        <FileViewer
          file={viewing}
          files={fileItems}
          workspaceId={wsId}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
          onRefresh={changed}
        />
      )}
    </div>
  );
}

function BackLink() {
  const t = useT();
  return (
    <Link to="/personas" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden="true" />
      {t('common.label.personas')}
    </Link>
  );
}

function PhotoTile({ file, personaName, picking, onOpen, onNotThis, onCover, onShowInFolder }: {
  file: PhotoRow;
  personaName: string | null;
  picking: boolean;
  onOpen: () => void;
  onNotThis: () => void;
  onCover: () => void;
  onShowInFolder: () => void;
}) {
  const t = useT();
  const name = file.name ?? '';
  return (
    <li className="group relative aspect-square overflow-hidden rounded-lg bg-muted">
      <button
        type="button"
        onClick={onOpen}
        aria-label={picking ? t('personas.action.useNameAsCover', { name }) : name}
        className={`size-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${picking ? 'cursor-crosshair hover:opacity-80' : ''}`}
      >
        <FilePreviewImage
          fileId={file.id}
          fileName={name}
          size={256}
          alt=""
          className="size-full object-cover"
          fallback={<ImageIcon className="size-6 m-auto text-muted-foreground" aria-hidden="true" />}
        />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('personas.action.photoOptions')}
          className="absolute top-1.5 inset-e-1.5 size-7 rounded-md inline-flex items-center justify-center bg-background/80 text-foreground shadow-sm opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 max-md:opacity-100"
        >
          <EllipsisVertical className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-40">
          <DropdownMenuItem onClick={onNotThis}>
            {personaName ? t('personas.action.notName', { name: personaName }) : t('personas.action.notThisPerson')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCover}>{t('personas.action.setAsCover')}</DropdownMenuItem>
          <DropdownMenuItem onClick={onShowInFolder}>{t('personas.action.showInFolder')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

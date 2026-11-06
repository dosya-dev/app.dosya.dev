import { useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, FileArchive, FolderOpen, Loader2, Upload, X } from 'lucide-react';
import { IntegrationLayout } from '@/components/integrations/integration-layout';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { getIntegration } from '@/lib/integrations';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { formatBytes, formatNumber } from '@/lib/format-locale';
import { missingParts, parsePartName, ROOT_FOLDER } from '@/lib/takeout/plan';
import { formatDuration, secondsLeft } from '@/lib/takeout/rate';
import type { ZipErrorCode } from '@/lib/takeout/zip';
import { useWorkspace } from '@/stores/workspace';
import { useTakeoutImport, type ChosenArchive } from '@/stores/takeout-import';

const meta = getIntegration('google-takeout')!;

export default function GoogleTakeoutImport() {
  const phase = useTakeoutImport((s) => s.phase);
  return (
    <IntegrationLayout icon={meta.icon} iconSrc={meta.iconSrc} title={meta.title} description={meta.description}>
      {phase === 'pick' && <PickCard />}
      {phase === 'ready' && <ReadyCard />}
      {(phase === 'running' || phase === 'paused' || phase === 'stopped') && <RunningCard />}
      {phase === 'done' && <DoneCard />}
    </IntegrationLayout>
  );
}

/** A hidden multi-file input plus the drag-and-drop handlers around it. */
function useZipPicker() {
  const addFiles = useTakeoutImport((s) => s.addFiles);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const accept = (files: FileList | null) => {
    if (files?.length) addFiles(Array.from(files));
  };
  return {
    open: () => input.current?.click(),
    over,
    dropProps: {
      onDragOver: (e: DragEvent) => { e.preventDefault(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => { e.preventDefault(); setOver(false); accept(e.dataTransfer.files); },
    },
    inputEl: (
      <input
        ref={input} type="file" multiple accept=".zip,application/zip" className="hidden"
        onChange={(e) => { accept(e.target.files); e.target.value = ''; }}
      />
    ),
  };
}

function PickCard() {
  const t = useT();
  const picker = useZipPicker();
  return (
    <section className="rounded-2xl border bg-card p-5">
      {picker.inputEl}
      <div
        {...picker.dropProps}
        className={`rounded-xl border-[1.5px] border-dashed px-5 py-9 text-center transition-colors ${picker.over ? 'border-foreground/40 bg-muted/60' : 'bg-muted/30'}`}
      >
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-muted">
          <Upload className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-semibold">{t('integrations-takeout.heading.dropYourTakeoutFilesHere')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('integrations-takeout.description.selectEveryPartAtOnce')}</p>
        <Button className="mt-4" onClick={picker.open}>{t('integrations-takeout.action.chooseFiles')}</Button>
      </div>
      <ol className="mt-5 grid gap-4 text-xs text-muted-foreground sm:grid-cols-3">
        <GuideStep n={1}>
          {richText(t('integrations-takeout.description.guideOpenTakeout'), {
            link1: <a href="https://takeout.google.com" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">takeout.google.com</a>,
          })}
        </GuideStep>
        <GuideStep n={2}>{t('integrations-takeout.description.guidePickZip')}</GuideStep>
        <GuideStep n={3}>{t('integrations-takeout.description.guideDownloadEveryPart')}</GuideStep>
      </ol>
    </section>
  );
}

function GuideStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function zipErrorText(t: ReturnType<typeof useT>, code: ZipErrorCode | undefined): string {
  switch (code) {
    case 'not-zip': return t('integrations-takeout.error.notAZip');
    case 'too-many': return t('integrations-takeout.error.tooManyFiles');
    default: return t('integrations-takeout.error.damagedArchive');
  }
}

function ArchiveRow({ archive, index }: { archive: ChosenArchive; index: number }) {
  const t = useT();
  const remove = useTakeoutImport((s) => s.removeArchive);
  const part = parsePartName(archive.file.name)?.part;
  return (
    <li className="flex items-center gap-3 border-b py-2.5 last:border-b-0">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FileArchive className="size-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[12px]">{archive.file.name}</p>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {archive.status === 'error'
            ? <span className="text-destructive">{zipErrorText(t, archive.error)}</span>
            : formatBytes(archive.file.size)}
        </p>
      </div>
      {archive.status === 'reading' && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label={t('integrations-takeout.status.reading')} />}
      {archive.status === 'ok' && part !== undefined && (
        <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-medium text-[#15803d] dark:bg-[#14532d] dark:text-[#86efac]">
          {t('integrations-takeout.label.partN', { n: part })}
        </span>
      )}
      <button
        type="button" onClick={() => remove(index)}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={t('integrations-takeout.action.removeFile')}
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

function ReadyCard() {
  const t = useT();
  const s = useTakeoutImport();
  const workspaceId = useWorkspace((w) => w.activeId);
  const picker = useZipPicker();
  const [picking, setPicking] = useState(false);
  const reading = s.archives.some((a) => a.status === 'reading');
  const missing = missingParts(s.archives.map((a) => a.file.name));
  const plan = s.plan;
  const totalSize = s.archives.reduce((n, a) => n + a.file.size, 0);
  const canStart = !!plan && plan.items.length > 0 && !reading && !!workspaceId;

  return (
    <section className="rounded-2xl border bg-card" {...picker.dropProps}>
      {picker.inputEl}
      <div className="px-5 py-4">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-sm font-semibold tabular-nums">
            {t('integrations-takeout.label.filesChosen', { count: s.archives.length, size: formatBytes(totalSize) })}
          </p>
          <Button variant="ghost" size="sm" onClick={picker.open}>{t('integrations-takeout.action.addMore')}</Button>
        </div>
        <ul>{s.archives.map((a, i) => <ArchiveRow key={`${a.file.name}|${a.file.size}`} archive={a} index={i} />)}</ul>
        {missing.length > 0 && (
          <p className="mt-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t('integrations-takeout.description.partsMissing', { parts: missing.map((m) => m.part).join(', ') })}
          </p>
        )}
      </div>

      {plan && (
        <div className="border-t px-5 py-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t('integrations-takeout.label.foundInside')}</p>
          <div className="space-y-1 text-sm">
            {(plan.photos > 0 || plan.videos > 0) && (
              <p>
                <span className="font-medium">Google Photos</span>{' '}
                <span className="tabular-nums text-muted-foreground">
                  · {t('integrations-takeout.label.photosVideosAlbums', { photos: plan.photos, videos: plan.videos, albums: plan.albums })}
                </span>
              </p>
            )}
            {plan.driveFiles > 0 && (
              <p>
                <span className="font-medium">Google Drive</span>{' '}
                <span className="tabular-nums text-muted-foreground">· {t('integrations-takeout.label.driveFiles', { count: plan.driveFiles })}</span>
              </p>
            )}
            {plan.otherFiles > 0 && (
              <p className="tabular-nums text-muted-foreground">{t('integrations-takeout.label.otherFiles', { count: plan.otherFiles })}</p>
            )}
            {plan.items.length === 0 && <p className="text-muted-foreground">{t('integrations-takeout.description.nothingToImport')}</p>}
          </div>
        </div>
      )}

      <div className="space-y-3 border-t px-5 py-4">
        <Option
          checked={s.applyDates} onChange={(v) => s.setOption('applyDates', v)}
          title={t('integrations-takeout.label.useDateTaken')} body={t('integrations-takeout.description.useDateTaken')}
        />
        <Option
          checked={s.dedupeAlbums} onChange={(v) => s.setOption('dedupeAlbums', v)}
          title={t('integrations-takeout.label.albumsOnce')} body={t('integrations-takeout.description.albumsOnce')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t bg-muted/30 px-5 py-4">
        <Button variant="outline" onClick={() => setPicking(true)} className="max-w-full">
          <FolderOpen className="size-4" />
          <span className="truncate">{t('integrations-takeout.action.into', { folder: s.dest.id ? `${s.dest.name} / ${ROOT_FOLDER}` : ROOT_FOLDER })}</span>
        </Button>
        <div className="flex items-center gap-3">
          {plan && <span className="text-[11px] tabular-nums text-muted-foreground">{t('integrations-takeout.label.needs', { size: formatBytes(plan.bytes) })}</span>}
          <Button disabled={!canStart} onClick={() => void s.start(workspaceId)}>{t('integrations-takeout.action.startImport')}</Button>
        </div>
      </div>
      {workspaceId && (
        <FolderPickerDialog
          open={picking} onClose={() => setPicking(false)} workspaceId={workspaceId}
          selectedId={s.dest.id} selectedName={s.dest.name}
          onSelect={(id, name) => { s.setDest(id, name); setPicking(false); }}
        />
      )}
    </section>
  );
}

function Option({ checked, onChange, title, body }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string }) {
  return (
    <label className="flex cursor-pointer gap-3">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(!!v)} className="mt-0.5" />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}

function RunningCard() {
  const t = useT();
  const s = useTakeoutImport();
  const workspaceId = useWorkspace((w) => w.activeId);
  const p = s.progress;
  if (!p) return null;
  const pct = p.totalBytes > 0 ? Math.min(100, Math.round((p.doneBytes / p.totalBytes) * 100)) : 0;
  const running = s.phase === 'running';
  const left = running ? secondsLeft(p.totalBytes - p.doneBytes, s.bps) : null;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums">
          {running
            ? t('integrations-takeout.status.importingNOfTotal', { n: formatNumber(p.done), total: formatNumber(p.total) })
            : t('integrations-takeout.status.pausedNOfTotal', { n: formatNumber(p.done), total: formatNumber(p.total) })}
        </p>
        {running
          ? <Button variant="ghost" size="sm" onClick={s.pause}>{t('integrations-takeout.action.pause')}</Button>
          : <Button size="sm" onClick={() => void s.start(workspaceId)}>{t('integrations-takeout.action.continue')}</Button>}
      </div>
      <div className="mb-2 mt-1 flex items-center justify-between gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
        <p data-testid="takeout-bytes">
          {left !== null
            ? t('common.label.itembytesuploadedItemfilesizeRemainingLeft', {
              itemBytesUploaded: formatBytes(p.doneBytes), itemFileSize: formatBytes(p.totalBytes), remaining: formatDuration(left),
            })
            : `${formatBytes(p.doneBytes)} / ${formatBytes(p.totalBytes)}`}
          {p.failures.length > 0 && <> · <span className="text-destructive">{t('integrations-takeout.label.failedCount', { count: p.failures.length })}</span></>}
        </p>
        {running && s.bps !== null && <p data-testid="takeout-speed" className="shrink-0">{t('common.label.bpsS', { bps: formatBytes(s.bps) })}</p>}
      </div>
      <Progress value={pct} />
      {s.phase === 'stopped' && (
        <p className="mt-4 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t('integrations-takeout.error.importStopped', { reason: s.stoppedBecause ?? '' })}
        </p>
      )}
      <p className="mt-4 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        {running ? t('integrations-takeout.description.keepTabOpen') : t('integrations-takeout.description.pickUpWhereLeft')}
      </p>
    </section>
  );
}

function DoneCard() {
  const t = useT();
  const s = useTakeoutImport();
  const p = s.progress!;
  const plan = s.plan!;
  const [showFailures, setShowFailures] = useState(false);
  const imported = p.done - p.failures.length;
  return (
    <section className="rounded-2xl border bg-card">
      <div className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-[#22c55e] text-white"><Check className="size-3" strokeWidth={3} /></span>
          <p className="text-sm font-semibold">{t('integrations-takeout.heading.importFinished')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat value={plan.photos} label={t('integrations-takeout.label.statPhotos', { count: plan.photos })} />
          <Stat value={plan.videos} label={t('integrations-takeout.label.statVideos', { count: plan.videos })} />
          <Stat value={plan.albums} label={t('integrations-takeout.label.statAlbums', { count: plan.albums })} />
          <Stat value={plan.driveFiles + plan.otherFiles} label={t('integrations-takeout.label.statOtherFiles', { count: plan.driveFiles + plan.otherFiles })} />
        </div>
        <ul className="mt-4 space-y-1 text-xs leading-relaxed text-muted-foreground">
          <li>{t('integrations-takeout.feedback.filesImported', { count: imported })}</li>
          {p.datesApplied > 0 && <li>{t('integrations-takeout.feedback.datesApplied', { count: p.datesApplied })}</li>}
          {plan.duplicatesSkipped > 0 && <li>{t('integrations-takeout.feedback.duplicatesSkipped', { count: plan.duplicatesSkipped })}</li>}
          {p.failures.length > 0 && (
            <li className="text-amber-700 dark:text-amber-400">
              {t('integrations-takeout.feedback.filesFailed', { count: p.failures.length })}{' '}
              <button type="button" className="underline underline-offset-2" onClick={() => setShowFailures((v) => !v)}>
                {showFailures ? t('integrations-takeout.action.hideList') : t('integrations-takeout.action.seeList')}
              </button>
            </li>
          )}
        </ul>
        {showFailures && (
          <ul className="mt-2 max-h-60 overflow-y-auto rounded-lg bg-muted p-3 font-mono text-[11px]">
            {p.failures.map((f, i) => <li key={i} className="truncate">{f.dir}/{f.name}: {f.reason}</li>)}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2 rounded-b-2xl border-t bg-muted/30 px-5 py-4">
        <Button variant="outline" onClick={s.reset}>{t('integrations-takeout.action.importMore')}</Button>
        {s.rootFolderId && (
          <Link to={`/files?folder=${s.rootFolderId}`} className={buttonVariants()}>{t('integrations-takeout.action.openFolder')}</Link>
        )}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5">
      <p className="text-xl font-semibold tabular-nums">{formatNumber(value)}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

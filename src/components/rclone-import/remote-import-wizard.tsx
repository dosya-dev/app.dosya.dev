import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, File as FileIcon, Folder, Loader2, PlugZap, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FolderPickerDialog } from '@/components/folder-picker-dialog';
import { ApiError, apiErrorMessage } from '@/api/client';
import { createJob, getJob, type RcloneBackend, type RcloneJob } from '@/api/rclone-import';
import { formatBytes } from '@/lib/format-locale';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { RcloneForm } from './rclone-form';
import { ServiceMark } from './service-mark';
import { collectOptions, joinPath, missingRequired, parentPath } from './form-model';

type Category = RcloneBackend['category'] | 'all';
type ProbeState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; entries: NonNullable<RcloneJob['entries']> }
  | { kind: 'error'; message: string };

/** rclone's own defaults, pre-filled so the form shows what will be used. */
function defaultsOf(b: RcloneBackend | null): Record<string, string> {
  const init: Record<string, string> = {};
  for (const o of b?.options ?? []) if (o.default && o.type !== 'bool' && !o.provider) init[o.name] = o.default;
  return init;
}

const FILTERS: { id: Category; key: 'profile.label.rcloneFilterAll' | 'profile.heading.rcloneCategoryObject' | 'profile.heading.rcloneCategoryDrive' | 'profile.heading.rcloneCategoryServer' }[] = [
  { id: 'all', key: 'profile.label.rcloneFilterAll' },
  { id: 'object', key: 'profile.heading.rcloneCategoryObject' },
  { id: 'drive', key: 'profile.heading.rcloneCategoryDrive' },
  { id: 'server', key: 'profile.heading.rcloneCategoryServer' },
];

const INITIAL_TILES = 12;
/** How long a connection test may take before the UI stops waiting. */
const PROBE_WAIT_MS = 120_000;
const now = () => Date.now();

const NATIVE = [
  { to: '/integrations/google', label: 'Google Drive', src: '/google-color.svg' },
  { to: '/integrations/onedrive', label: 'OneDrive', src: '/onedrive-color.svg' },
  { to: '/integrations/dropbox', label: 'Dropbox', src: '/dropbox-color.svg' },
];

/** The field the API named in `{code: 'invalid_option', field}`, if any. */
function fieldOf(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  try { return (JSON.parse(err.body) as { field?: string }).field ?? null; } catch { return null; }
}

function Stepper({ step, onBack }: { step: 0 | 1 | 2; onBack: () => void }) {
  const t = useT();
  const labels = [t('profile.label.rcloneStepSource'), t('profile.label.rcloneStepConnect'), t('profile.label.rcloneStepDestination')];
  return (
    <ol className="flex items-center gap-2 text-[12px]" aria-label={t('profile.heading.rcloneNewImport')}>
      {labels.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'current' : 'todo';
        return (
          <li key={label} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className={cn('h-px w-5 sm:w-8', i <= step ? 'bg-primary/60' : 'bg-border')} />}
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
                state === 'done' && 'bg-primary text-primary-foreground',
                state === 'current' && 'bg-foreground text-background',
                state === 'todo' && 'bg-muted text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check className="size-3" /> : i + 1}
            </span>
            {i === 0 && step > 0 ? (
              <button type="button" onClick={onBack} className="hidden rounded font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:inline">{label}</button>
            ) : (
              <span className={cn('hidden sm:inline', state === 'todo' ? 'text-muted-foreground' : 'font-medium')}>{label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * New import, inline on the page: pick a service, connect and browse it,
 * choose where it lands, start. The copy then runs on our server.
 */
export function RemoteImportWizard({ backends, workspaceId, canStart, onStarted }: {
  backends: RcloneBackend[];
  workspaceId: string;
  /** False while another import is running or the allowance is used: browsing still works, starting does not. */
  canStart: boolean;
  onStarted: (job: RcloneJob) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Category>('all');
  const [showAll, setShowAll] = useState(false);
  // The chosen service lives in the URL (?service=s3), so the browser's Back
  // button returns to the service list instead of leaving the page.
  const [params, setParams] = useSearchParams();
  const backend = backends.find((b) => b.name === params.get('service')) ?? null;
  const [formFor, setFormFor] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [path, setPath] = useState('');
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' });
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [dest, setDest] = useState<{ id: string | null; name: string }>({ id: null, name: '' });
  const [pickingDest, setPickingDest] = useState(false);
  const [starting, setStarting] = useState(false);
  const probeSeq = useRef(0);
  const topRef = useRef<HTMLElement>(null);

  // A different service (picked, or reached with Back/Forward) starts a fresh
  // form. Adjusted during render, React's pattern for state derived from a prop.
  if ((backend?.name ?? null) !== formFor) {
    setFormFor(backend?.name ?? null);
    setValues(defaultsOf(backend)); setPath(''); setProbe({ kind: 'idle' }); setInvalidField(null);
  }

  // A probe still polling after the user moved on must not write into the new state.
  useEffect(() => { probeSeq.current++; }, [backend?.name]);
  useEffect(() => () => { probeSeq.current++; }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return backends.filter((b) =>
      (filter === 'all' || b.category === filter) &&
      (!q || b.label.toLowerCase().includes(q) || b.name.includes(q)));
  }, [backends, query, filter]);
  // The full list is 40+ tiles; open on the first rows and let the user ask for the rest.
  const collapsed = filter === 'all' && !query.trim() && !showAll && filtered.length > INITIAL_TILES;
  const shown = collapsed ? filtered.slice(0, INITIAL_TILES) : filtered;

  const choose = (b: RcloneBackend) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set('service', b.name); return n; });
    topRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  const reset = () => {
    setParams((p) => { const n = new URLSearchParams(p); n.delete('service'); return n; }, { replace: true });
  };

  const runProbe = async (at: string) => {
    if (!backend) return;
    const seq = ++probeSeq.current;
    setProbe({ kind: 'running' }); setInvalidField(null);
    try {
      let job = await createJob({ kind: 'probe', backend: backend.name, options: collectOptions(backend, values), source_path: at, workspace_id: workspaceId });
      const deadline = now() + PROBE_WAIT_MS;
      while ((job.status === 'queued' || job.status === 'running') && now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        if (seq !== probeSeq.current) return;
        job = await getJob(job.id);
      }
      if (seq !== probeSeq.current) return;
      if (job.status === 'complete') { setPath(at); setProbe({ kind: 'ok', entries: job.entries ?? [] }); }
      else setProbe({ kind: 'error', message: job.error_message || t('profile.error.rcloneTestFailed') });
    } catch (err) {
      if (seq !== probeSeq.current) return;
      setInvalidField(fieldOf(err));
      setProbe({ kind: 'error', message: apiErrorMessage(err) });
    }
  };

  const start = async () => {
    if (!backend) return;
    setStarting(true);
    try {
      const job = await createJob({
        kind: 'import', backend: backend.name, options: collectOptions(backend, values), source_path: path,
        workspace_id: workspaceId, dest_folder_id: dest.id, label: backend.label,
      });
      toast.success(t('profile.feedback.rcloneImportStarted'), t('profile.feedback.rcloneImportStartedBody'));
      onStarted(job);
      reset();
    } catch (err) {
      setInvalidField(fieldOf(err));
      toast.error(t('profile.error.rcloneCouldNotStart'), apiErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const missing = backend ? missingRequired(backend, values) : [];
  const step: 0 | 1 | 2 = !backend ? 0 : probe.kind === 'ok' ? 2 : 1;

  return (
    <section ref={topRef} aria-labelledby="rclone-new-import" className="scroll-mt-6 rounded-2xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <h2 id="rclone-new-import" className="text-[15px] font-semibold tracking-tight">{t('profile.heading.rcloneNewImport')}</h2>
        <Stepper step={step} onBack={reset} />
      </header>

      {!backend ? (
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative sm:max-w-xs sm:flex-1">
              <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="ps-8" placeholder={t('profile.placeholder.rcloneSearchServices')} aria-label={t('profile.placeholder.rcloneSearchServices')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div role="group" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    filter === f.id ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {t(f.key)}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed py-10 text-center text-[13px] text-muted-foreground">{t('profile.label.rcloneNoServiceMatches')}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => choose(b)}
                    className="group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-start transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <ServiceMark backend={b} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{b.label}</span>
                    {b.oauth && <Badge variant="outline" className="text-[10px] font-medium text-muted-foreground">{t('profile.label.rcloneTokenBadge')}</Badge>}
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 rtl:rotate-180" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {collapsed && (
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setShowAll(true)}>
              {t('profile.action.rcloneShowAll', { count: filtered.length })}
            </Button>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-4 text-[12px] text-muted-foreground">
            <span>{t('profile.description.rcloneNativeImportersHint')}</span>
            {NATIVE.map((n) => (
              <Link key={n.to} to={n.to} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-medium text-foreground hover:bg-muted">
                <img src={n.src} alt="" className="size-3.5" /> {n.label}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 border-b px-5 py-3 sm:px-6">
            <Button type="button" variant="ghost" size="icon-sm" className="-ms-2 shrink-0" aria-label={t('profile.action.rcloneBackToServices')} title={t('profile.action.rcloneBackToServices')} onClick={reset}>
              <ArrowLeft className="size-4 rtl:rotate-180" />
            </Button>
            <ServiceMark backend={backend} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{backend.label}</p>
              <p className="truncate text-[12px] text-muted-foreground">{t('profile.description.rcloneConnectionHint')}</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={reset}>{t('profile.action.rcloneChange')}</Button>
          </div>

          <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <RcloneForm backend={backend} values={values} invalidField={invalidField} onChange={(v) => { setValues(v); setProbe({ kind: 'idle' }); }} />

            <div className="flex min-w-0 flex-col gap-3">
              <div className="space-y-1">
                <label htmlFor="rclone-source-path" className="text-sm font-medium">{t('profile.label.rcloneSourcePath')}</label>
                <div className="flex gap-2">
                  <Input
                    id="rclone-source-path" dir="ltr" spellCheck={false} className={cn(path && 'font-mono text-[13px]')}
                    placeholder={t('profile.placeholder.rcloneSourcePath')} value={path}
                    onChange={(e) => { setPath(e.target.value); setProbe({ kind: 'idle' }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && missing.length === 0) void runProbe(path); }}
                  />
                  <Button type="button" variant="outline" className="shrink-0 gap-1.5" disabled={missing.length > 0 || probe.kind === 'running'} onClick={() => void runProbe(path)}>
                    {probe.kind === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
                    {t('profile.action.rcloneTestConnection')}
                  </Button>
                </div>
              </div>

              <div className="flex min-h-56 flex-1 flex-col overflow-hidden rounded-xl border bg-background/60">
                {probe.kind === 'ok' && (
                  <div className="flex items-center justify-between gap-2 border-b bg-card px-3 py-2">
                    <span dir="ltr" className="truncate font-mono text-[12px]">{path || '/'}</span>
                    {path && (
                      <button type="button" className="shrink-0 text-[12px] font-medium text-primary hover:underline" onClick={() => void runProbe(parentPath(path))}>
                        {t('profile.action.rcloneUpOneLevel')}
                      </button>
                    )}
                  </div>
                )}
                {probe.kind === 'idle' && (
                  <p className="m-auto max-w-[32ch] px-4 py-8 text-center text-[13px] text-muted-foreground">{t('profile.description.rcloneBrowseHint')}</p>
                )}
                {probe.kind === 'running' && (
                  <div className="space-y-2 p-3" aria-busy>
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-6" style={{ width: `${80 - i * 12}%` }} />)}
                  </div>
                )}
                {probe.kind === 'error' && (
                  <div role="alert" className="m-3 rounded-lg bg-destructive/10 px-3 py-2.5 text-[12px] text-destructive">
                    <p className="font-medium">{t('profile.error.rcloneTestFailed')}</p>
                    <p className="mt-1 break-words font-mono text-[11px] opacity-90">{probe.message}</p>
                  </div>
                )}
                {probe.kind === 'ok' && (
                  <>
                    <ul className="max-h-64 flex-1 overflow-y-auto py-1 text-[13px]">
                      {probe.entries.length === 0 && <li className="px-3 py-6 text-center text-[12px] text-muted-foreground">{t('common.description.thisFolderIsEmpty')}</li>}
                      {probe.entries.map((e) => (
                        <li key={e.name}>
                          {e.kind === 'dir' ? (
                            <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-start hover:bg-muted" onClick={() => void runProbe(joinPath(path, e.name))}>
                              <Folder aria-hidden className="size-4 shrink-0 text-primary" /><span className="truncate">{e.name}</span>
                              <ChevronRight aria-hidden className="ms-auto size-3.5 shrink-0 text-muted-foreground rtl:rotate-180" />
                            </button>
                          ) : (
                            <div className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground">
                              <FileIcon aria-hidden className="size-4 shrink-0" /><span className="flex-1 truncate">{e.name}</span>
                              <span className="font-mono text-[11px] tabular-nums">{formatBytes(e.size)}</span>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="flex items-center gap-1.5 border-t px-3 py-2 text-[12px] text-muted-foreground">
                      <Check aria-hidden className="size-3.5 shrink-0 text-primary" /> {t('profile.description.rcloneConnectionWorks')}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          <footer className="flex flex-col gap-3 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="shrink-0 text-muted-foreground">{t('profile.label.rcloneDestination')}</span>
              <Button type="button" variant="outline" size="sm" className="min-w-0 max-w-full gap-1.5" onClick={() => setPickingDest(true)}>
                <Folder className="size-3.5 shrink-0" />
                <span className="truncate">{dest.id ? dest.name : t('common.label.workspaceRoot')}</span>
              </Button>
            </div>
            <Button disabled={probe.kind !== 'ok' || starting || !canStart} onClick={() => void start()} className="gap-1.5">
              {starting && <Loader2 className="size-3.5 animate-spin" />}
              {t('profile.action.rcloneStartImport')}
            </Button>
          </footer>
        </>
      )}

      <FolderPickerDialog
        open={pickingDest}
        onClose={() => setPickingDest(false)}
        workspaceId={workspaceId}
        selectedId={dest.id}
        selectedName={dest.name}
        onSelect={(id, name) => { setDest({ id, name }); setPickingDest(false); }}
      />
    </section>
  );
}

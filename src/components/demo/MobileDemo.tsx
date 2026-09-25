import { useEffect, useRef, useState } from 'react';
import { breadcrumbs, DemoProvider, useDemo, visibleItems } from './engine/demoState';
import { DemoToast } from './core/DemoToast';
import { PreviewPane } from './core/PreviewPane';
import { Lightbox } from './core/Lightbox';
import { ShareModal } from './core/ShareModal';
import { ThemeBar } from './web/ThemeBar';
import {
  folderIconSrc, humanSize, DEMO_USER, DEMO_WORKSPACE, type DemoFile, type DemoFolder, type DemoThemeId,
} from './engine/demoData';
import { Ion, type IonName } from './mobile/ionicons';
import { cradle } from './mobile/cradle';
import './demo-themes.css';

/*
 * A replica of the real dosya mobile app (apps/mobile), screen for screen.
 *
 * Everything visual here is transcribed from the app's own components:
 * WorkspaceHeader, FileBrowser (chips + list/grid toggle, FolderCard /
 * FileCard / FolderRow / FileRow), the Backup tab (CoverageRing,
 * CoverageFigures, StorageBar, ActivityFeed), the Settings tab (account
 * card, ShortcutTile grid, Section + SettingsRow) and OrbitTabBar with its
 * CradleBar, OrbitButton and OrbitSheet. Sizes are the app's own points on a
 * 402x874 iPhone 17 canvas; the phone is scaled to fit the page with `zoom`.
 * Icons are the same Ionicons glyphs the app draws.
 *
 * Only the demo engine underneath is shared with the web/desktop demos, so
 * uploads, previews, sharing and the theme picker behave the same across
 * all three.
 */

type MobileTab = 'files' | 'backup' | 'settings';
type Chip = 'all' | 'docs' | 'images' | 'videos';

const PHONE_W = 402;
const PHONE_H = 874;
const ORBIT_SIZE = 56;
const BAR_PAD_X = 10;

const CHIPS: { key: Chip; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'docs', label: 'Docs' }, { key: 'images', label: 'Images' }, { key: 'videos', label: 'Videos' },
];

function chipMatches(chip: Chip, f: DemoFile): boolean {
  if (chip === 'all') return true;
  if (chip === 'images') return f.kind === 'image';
  if (chip === 'videos') return f.kind === 'video';
  return f.kind === 'doc' || f.kind === 'text';
}

/** The glyph FileThumb falls back to when a file has no image thumbnail. */
function kindGlyph(f: DemoFile): IonName {
  switch (f.kind) {
    case 'video': return 'play-circle';
    case 'archive': return 'archive';
    case 'doc': return f.name.endsWith('.pdf') ? 'document-text' : 'document-attach';
    case 'text': return 'document';
    default: return 'document-outline';
  }
}

// ── Chrome ────────────────────────────────────────────────────────────────

// iOS 26 status bar on an iPhone 17: time left, signal / Wi-Fi / battery right.
function StatusBar() {
  return (
    <div className="relative z-30 flex h-[59px] items-center justify-between px-[38px] pt-1 text-(--demo-fg)">
      <span className="text-[17px] font-semibold tracking-tight">9:41</span>
      <div className="flex items-center gap-[7px]">
        <svg width="19" height="12" viewBox="0 0 19 12" fill="currentColor" aria-hidden="true">
          <rect x="0" y="8" width="3.5" height="4" rx="1" /><rect x="5" y="5.5" width="3.5" height="6.5" rx="1" />
          <rect x="10" y="3" width="3.5" height="9" rx="1" /><rect x="15" y="0" width="3.5" height="12" rx="1" />
        </svg>
        <svg width="17" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <path d="M8 2.5c2.5 0 4.8 1 6.4 2.6l-1.4 1.4A7 7 0 0 0 8 4.5 7 7 0 0 0 3 6.5L1.6 5.1A9 9 0 0 1 8 2.5Zm0 4a5 5 0 0 1 3.5 1.4l-1.4 1.5A3 3 0 0 0 8 8.5a3 3 0 0 0-2.1.9L4.5 7.9A5 5 0 0 1 8 6.5Zm0 3.8 1.4 1.5-1.4 .2-1.4-.2 1.4-1.5Z" />
        </svg>
        <svg width="28" height="13" viewBox="0 0 28 13" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="24" height="12" rx="3.5" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="21" height="9" rx="2" fill="currentColor" />
          <rect x="26" y="4.5" width="1.5" height="4" rx="0.75" fill="currentColor" fillOpacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

// WorkspaceHeader: switcher (avatar + name + role + chevron), gear, search, bell.
function WorkspaceHeader({ back, onBack }: { back?: boolean; onBack?: () => void }) {
  const { dispatch } = useDemo();
  const tell = (text: string) => dispatch({ type: 'TOAST', toast: { text, cta: true } });
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-2">
      {back && (
        <button aria-label="Go back" onClick={onBack} className="shrink-0 text-(--demo-fg)">
          <Ion name="chevron-back" size={24} />
        </button>
      )}
      <button data-testid="ws-trigger" onClick={() => tell('Switch workspaces in the full app')}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-white"
          style={{ background: DEMO_WORKSPACE.color }}>{DEMO_WORKSPACE.initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-bold leading-tight text-(--demo-fg)">{DEMO_WORKSPACE.name}</span>
          <span className="block truncate text-xs leading-tight text-(--demo-muted-fg)">Owner</span>
        </span>
        <Ion name="chevron-down" size={18} className="text-(--demo-muted-fg)" />
      </button>
      <button aria-label="Workspace settings" onClick={() => tell('Workspace settings live in the full app')} className="-m-2 shrink-0 p-2 text-(--demo-muted-fg)">
        <Ion name="settings-outline" size={22} />
      </button>
      <button aria-label="Search" onClick={() => tell('Search across everything in the full app')} className="-m-2 shrink-0 p-2 text-(--demo-fg)">
        <Ion name="search" size={22} />
      </button>
      <button aria-label="Notifications, 3 unread" onClick={() => tell('Notifications arrive in the full app')} className="relative -m-2 shrink-0 p-2 text-(--demo-fg)">
        <Ion name="notifications-outline" size={22} />
        <span className="absolute right-0.5 top-1 grid min-w-4 place-items-center rounded-full bg-(--demo-primary) px-1 text-[10px] font-medium leading-4 text-(--demo-primary-fg)">3</span>
      </button>
    </div>
  );
}

// ── Files tab ─────────────────────────────────────────────────────────────

function FileThumb({ file, variant }: { file: DemoFile; variant: 'grid' | 'list' }) {
  const hasImage = (file.kind === 'image' || file.kind === 'video') && !!file.thumb;
  const box = variant === 'grid'
    ? 'relative aspect-square w-full overflow-hidden rounded-xl bg-(--demo-muted)'
    : 'relative size-10 shrink-0 overflow-hidden rounded-lg bg-(--demo-muted)';
  return (
    <span className={`${box} grid place-items-center text-(--demo-muted-fg)`}>
      {hasImage ? (
        <>
          <span className="absolute inset-0" style={{ background: file.thumb }} />
          {file.kind === 'video' && (
            <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center text-white/90">
              <Ion name="play-circle" size={variant === 'grid' ? 44 : 22} />
            </span>
          )}
        </>
      ) : (
        <Ion name={kindGlyph(file)} size={variant === 'grid' ? 40 : 22} />
      )}
    </span>
  );
}

function FolderCard({ folder, hasChildren, onOpen }: { folder: DemoFolder; hasChildren: boolean; onOpen: () => void }) {
  return (
    <button data-demo-tile onClick={onOpen} className="min-w-0 p-1.5 text-left">
      <span className="grid aspect-square w-full place-items-center rounded-xl bg-(--demo-muted)">
        <img src={folderIconSrc(hasChildren)} alt="" className="size-11" width={44} height={44} />
      </span>
      <span className="mt-1 block truncate text-xs text-(--demo-fg)">{folder.name}</span>
    </button>
  );
}

function FileCard({ file }: { file: DemoFile }) {
  const { dispatch } = useDemo();
  return (
    <button data-demo-tile onClick={() => dispatch({ type: 'PREVIEW', fileId: file.id })} className="min-w-0 p-1.5 text-left">
      <span className="relative block">
        <FileThumb file={file} variant="grid" />
        {file.shared && (
          <span className="absolute left-1 top-1 grid rounded-full bg-black/50 p-1 text-white"><Ion name="link" size={12} /></span>
        )}
      </span>
      <span className="mt-1 block truncate text-xs text-(--demo-fg)">{file.name}</span>
    </button>
  );
}

function FolderRow({ folder, count, onOpen }: { folder: DemoFolder; count: number; onOpen: () => void }) {
  return (
    <button data-demo-row onClick={onOpen} className="flex w-full items-center gap-3 border-b border-(--demo-border) px-5 py-3 text-left">
      <img src={folderIconSrc(count > 0)} alt="" className="size-[26px] shrink-0" width={26} height={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-(--demo-fg)">{folder.name}</span>
        <span className="block text-xs text-(--demo-muted-fg)">{count} item{count === 1 ? '' : 's'}</span>
      </span>
      <span className="text-(--demo-muted-fg)"><Ion name="ellipsis-horizontal" size={20} /></span>
      <span className="text-(--demo-muted-fg)"><Ion name="chevron-forward" size={18} /></span>
    </button>
  );
}

function FileRow({ file }: { file: DemoFile }) {
  const { dispatch } = useDemo();
  return (
    <button data-demo-row onClick={() => dispatch({ type: 'PREVIEW', fileId: file.id })}
      className="flex w-full items-center gap-3 border-b border-(--demo-border) px-5 py-3 text-left">
      <FileThumb file={file} variant="list" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base text-(--demo-fg)">{file.name}</span>
        <span className="block truncate text-xs text-(--demo-muted-fg)">{humanSize(file.sizeBytes)} · {file.modified}</span>
      </span>
      {file.shared && <span className="text-(--demo-muted-fg)"><Ion name="link" size={16} /></span>}
      <span className="text-(--demo-muted-fg)"><Ion name="ellipsis-horizontal" size={20} /></span>
    </button>
  );
}

function FilesTab() {
  const { state, dispatch } = useDemo();
  const [chip, setChip] = useState<Chip>('all');
  const trail = breadcrumbs(state);
  const { folders, files: allFiles } = visibleItems(state);
  const files = allFiles.filter((f) => chipMatches(chip, f));
  const isGrid = state.view === 'grid';
  const countIn = (fid: string) => state.files.filter((x) => x.folderId === fid).length + state.folders.filter((x) => x.parentId === fid).length;
  const tell = (text: string) => dispatch({ type: 'TOAST', toast: { text, cta: true } });
  const goBack = () => dispatch({ type: 'NAVIGATE', folderId: trail.length > 1 ? trail[trail.length - 2].id : null });
  const current = trail[trail.length - 1];

  return (
    <>
      <WorkspaceHeader back={trail.length > 0} onBack={goBack} />
      {current && (
        <div className="px-5 pb-1 pt-1">
          <h3 className="text-2xl font-bold text-(--demo-fg)">{current.name}</h3>
        </div>
      )}
      {/* Chips scroll; the action icons stay pinned outside the scroller. */}
      <div className="flex items-center justify-between gap-2.5 px-5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {CHIPS.map((c) => (
            <button key={c.key} onClick={() => setChip(c.key)} aria-pressed={chip === c.key}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[13px] ${chip === c.key ? 'bg-(--demo-primary) text-(--demo-primary-fg)' : 'bg-(--demo-muted) text-(--demo-fg)'}`}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <button aria-label="Sort" onClick={() => dispatch({ type: 'TOGGLE_SORT', key: 'modified' })} className="-m-1.5 p-1.5 text-(--demo-muted-fg)">
            <Ion name="swap-vertical" size={18} />
          </button>
          <div className="flex overflow-hidden rounded-md border border-(--demo-border)">
            <button aria-label="List view" aria-pressed={!isGrid} onClick={() => dispatch({ type: 'SET_VIEW', view: 'list' })}
              className={`px-2 py-1 ${!isGrid ? 'bg-(--demo-muted) text-(--demo-fg)' : 'text-(--demo-muted-fg)'}`}>
              <Ion name="list" size={18} />
            </button>
            <button aria-label="Grid view" aria-pressed={isGrid} onClick={() => dispatch({ type: 'SET_VIEW', view: 'grid' })}
              className={`px-2 py-1 ${isGrid ? 'bg-(--demo-muted) text-(--demo-fg)' : 'text-(--demo-muted-fg)'}`}>
              <Ion name="grid" size={16} />
            </button>
          </div>
          <button aria-label="New folder" onClick={() => tell('Create folders in the full app')} className="-m-1.5 p-1.5 text-(--demo-primary)">
            <Ion name="folder-open-outline" size={22} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {folders.length + files.length === 0 ? (
          <p className="py-16 text-center text-base text-(--demo-muted-fg)">This folder is empty.</p>
        ) : isGrid ? (
          <div className="grid grid-cols-3 px-2 pt-1">
            {folders.map((f) => (
              <FolderCard key={f.id} folder={f} hasChildren={countIn(f.id) > 0} onOpen={() => dispatch({ type: 'NAVIGATE', folderId: f.id })} />
            ))}
            {files.map((f) => <FileCard key={f.id} file={f} />)}
          </div>
        ) : (
          <div>
            {folders.map((f) => (
              <FolderRow key={f.id} folder={f} count={countIn(f.id)} onOpen={() => dispatch({ type: 'NAVIGATE', folderId: f.id })} />
            ))}
            {files.map((f) => <FileRow key={f.id} file={f} />)}
          </div>
        )}
      </div>
    </>
  );
}

// ── Backup tab ────────────────────────────────────────────────────────────

const RING_SIZE = 200;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;
const CORE_SIZE = RING_SIZE - RING_STROKE * 2 - 24;
const GLYPH = 40;
const FRAME = RING_SIZE + 40;
const LIBRARY_TOTAL = 1498;
const RUN_MS = 4000;

function CoverageRing({ running, uploaded, onPress }: { running: boolean; uploaded: number; onPress: () => void }) {
  const fraction = uploaded / LIBRARY_TOTAL;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const label = running ? 'Backing up' : 'Protected';
  const glyph: IonName = running ? 'pause' : 'shield-checkmark';
  return (
    <div className="flex flex-col items-center pt-2">
      <div className="relative grid place-items-center" style={{ width: FRAME, height: FRAME }} role="progressbar"
        aria-label={`${uploaded} of ${LIBRARY_TOTAL} protected`} aria-valuemin={0} aria-valuemax={LIBRARY_TOTAL} aria-valuenow={uploaded}>
        {running && (
          <>
            <span className="demo-halo absolute rounded-full bg-(--demo-primary)" style={{ width: CORE_SIZE, height: CORE_SIZE }} />
            <span className="demo-halo absolute rounded-full bg-(--demo-primary)" style={{ width: CORE_SIZE, height: CORE_SIZE, animationDelay: '1s' }} />
          </>
        )}
        <svg className="pointer-events-none absolute" width={RING_SIZE} height={RING_SIZE} aria-hidden="true">
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} stroke="var(--demo-muted)" strokeWidth={RING_STROKE} strokeLinecap="round" fill="none" />
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} stroke="var(--demo-primary)" strokeWidth={RING_STROKE} strokeLinecap="round" fill="none"
            strokeDasharray={RING_CIRC} strokeDashoffset={RING_CIRC * (1 - fraction)} transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            style={{ transition: 'stroke-dashoffset 600ms ease' }} />
        </svg>
        <button data-testid={running ? 'backup-stop' : 'backup-now'} aria-label={running ? 'Stop backup' : 'Start backup'} onClick={onPress}
          className="relative z-10 rounded-full transition-transform active:scale-[.96]"
          style={{
            width: CORE_SIZE, height: CORE_SIZE,
            background: running ? 'var(--demo-primary)' : 'var(--demo-card)',
            border: running ? 'none' : '1px solid var(--demo-border)',
            boxShadow: running ? '0 6px 22px color-mix(in srgb, var(--demo-primary) 40%, transparent)' : '0 6px 10px rgba(0,0,0,0.1)',
            color: running ? 'var(--demo-primary-fg)' : 'var(--demo-primary)',
          }}>
          <span className="pointer-events-none absolute inset-0 grid place-items-center"><Ion name={glyph} size={GLYPH} /></span>
          <span className="pointer-events-none absolute inset-x-4 text-center text-xs font-semibold"
            style={{ top: CORE_SIZE / 2 + GLYPH / 2 + 4, color: running ? 'var(--demo-primary-fg)' : 'var(--demo-fg)' }}>{label}</span>
        </button>
      </div>
      <p className="mt-3 text-[22px] font-bold text-(--demo-fg)">{uploaded.toLocaleString('en-US')} of {LIBRARY_TOTAL.toLocaleString('en-US')} protected</p>
      <p className="mt-1 text-sm text-(--demo-muted-fg)">
        {running ? `Tap to stop · 4.2 MB/s · ${Math.max(1, Math.ceil((RUN_MS / 1000) - elapsed))}s left · 0:0${Math.min(9, elapsed)}` : 'Start backup · Last run just now'}
      </p>
    </div>
  );
}

function BackupTab() {
  const { dispatch } = useDemo();
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const onEngine = () => {
    if (running) {
      if (timer.current) window.clearTimeout(timer.current);
      setRunning(false);
      return;
    }
    setRunning(true);
    timer.current = window.setTimeout(() => {
      setRunning(false);
      dispatch({ type: 'TOAST', toast: { text: 'Backup finished · 3 new photos safe in SYD', cta: true } });
    }, RUN_MS);
  };
  const tell = (text: string) => dispatch({ type: 'TOAST', toast: { text, cta: true } });
  const used = 24.3, total = 100;
  return (
    <>
      <WorkspaceHeader />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <CoverageRing running={running} uploaded={running ? LIBRARY_TOTAL - 3 : LIBRARY_TOTAL} onPress={onEngine} />

        <div className="mt-4 flex overflow-hidden rounded-2xl border border-(--demo-border) bg-(--demo-card)">
          {[[running ? '1,495' : '1,498', 'Backed up'], [running ? '3' : '0', 'Pending'], ['0', 'Failed']].map(([n, l], i) => (
            <div key={l} className={`flex flex-1 flex-col items-center px-1 py-2.5 ${i < 2 ? 'border-r border-(--demo-border)' : ''}`}>
              <span className="text-lg font-bold text-(--demo-fg)">{n}</span>
              <span className="text-[10px] text-(--demo-muted-fg)">{l}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-(--demo-border) bg-(--demo-card) p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-(--demo-muted-fg)">{used} GB of {total.toFixed(1)} GB used</span>
            <span className="text-xs font-medium text-(--demo-fg)">{(total - used).toFixed(1)} GB free</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-(--demo-muted)">
            <div className="h-full rounded-full bg-(--demo-primary)" style={{ width: `${(used / total) * 100}%` }} />
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-(--demo-border) bg-(--demo-card)">
          <div className="flex items-center gap-3 border-b border-(--demo-border) px-3 py-2.5 text-(--demo-muted-fg)">
            <Ion name="location" size={18} />
            <span className="flex-1 text-xs text-(--demo-fg)">{DEMO_WORKSPACE.name} · Sydney, Australia</span>
          </div>
          <button onClick={() => tell('Choose folders and file types in the full app')} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-(--demo-muted-fg)">
            <Ion name="options" size={18} />
            <span className="flex-1">
              <span className="block text-xs font-semibold text-(--demo-fg)">What gets backed up</span>
              <span className="mt-0.5 block text-xs text-(--demo-muted-fg)">Photos and videos from every folder</span>
            </span>
            <Ion name="chevron-forward" size={16} />
          </button>
        </div>

        <div className="mb-6 mt-8">
          <p className="mb-2 text-sm font-semibold text-(--demo-muted-fg)">Activity</p>
          {running && (
            <div className="mb-3 overflow-hidden rounded-2xl border border-(--demo-border) bg-(--demo-card)">
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="size-3.5 animate-spin rounded-full border-2 border-(--demo-primary) border-t-transparent" />
                <span className="text-sm font-medium text-(--demo-fg)">Scanning your library…</span>
              </div>
            </div>
          )}
          <div className="rounded-2xl border border-(--demo-border) bg-(--demo-card)">
            {[
              ['Just now', '12 uploaded · 3 already backed up'],
              ['Yesterday, 22:10', '48 uploaded'],
              ['Mon, 08:14', 'Nothing new'],
            ].map(([when, sub], i, arr) => (
              <div key={when} className={`px-4 py-3 ${i === arr.length - 1 ? '' : 'border-b border-(--demo-border)'}`}>
                <div className="flex items-center gap-2 text-(--demo-primary)">
                  <Ion name="checkmark-circle" size={14} />
                  <span className="text-sm text-(--demo-fg)">{when} · {DEMO_WORKSPACE.name}</span>
                </div>
                <p className="mt-0.5 pl-6 text-xs text-(--demo-muted-fg)">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Settings tab ──────────────────────────────────────────────────────────

const SHORTCUTS: { icon: IonName; label: string }[] = [
  { icon: 'star', label: 'Favourites' },
  { icon: 'share-social-outline', label: 'Shares' },
  { icon: 'trash', label: 'Trash' },
  { icon: 'copy-outline', label: 'Duplicates' },
  { icon: 'map-outline', label: 'Map' },
  { icon: 'cloud-upload-outline', label: 'Requests' },
  { icon: 'albums', label: 'Groups' },
  { icon: 'people', label: 'Contacts' },
];

function SettingsRow({ icon, label, description, value, right, border, onPress }: {
  icon: IonName; label: string; description?: string; value?: string; right?: React.ReactNode; border?: boolean; onPress: () => void;
}) {
  return (
    <button onClick={onPress} className={`flex w-full items-center gap-3 px-4 py-3 text-left ${border ? 'border-b border-(--demo-border)' : ''}`}>
      <span className="text-(--demo-muted-fg)"><Ion name={icon} size={20} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-base text-(--demo-fg)">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-(--demo-muted-fg)">{description}</span>}
      </span>
      {value && <span className="text-sm text-(--demo-muted-fg)">{value}</span>}
      {right ?? <span className="text-(--demo-muted-fg)"><Ion name="chevron-forward" size={18} /></span>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <p className="mb-2 text-base font-bold text-(--demo-fg)">{title}</p>
      <div className="overflow-hidden rounded-lg border border-(--demo-border) bg-(--demo-card)">{children}</div>
    </div>
  );
}

function SettingsTab() {
  const { dispatch } = useDemo();
  const tell = (what: string) => dispatch({ type: 'TOAST', toast: { text: `${what} lives in the full app`, cta: true } });
  const initials = DEMO_USER.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <>
      <WorkspaceHeader />
      <div className="px-5 pb-2 pt-1"><h3 className="text-2xl font-bold text-(--demo-fg)">Settings</h3></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <button onClick={() => tell('Your profile')} className="mb-6 flex w-full items-center gap-3 rounded-lg border border-(--demo-border) bg-(--demo-card) p-4 text-left">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--demo-muted) text-[15px] font-bold text-(--demo-muted-fg)">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-(--demo-fg)">{DEMO_USER.name}</span>
            <span className="block truncate text-sm text-(--demo-muted-fg)">{DEMO_USER.email}</span>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-(--demo-muted)"><span className="block h-full w-[24.3%] rounded-full bg-(--demo-primary)" /></span>
            <span className="mt-1 block text-xs text-(--demo-muted-fg)">24.3 GB of 100.0 GB used</span>
          </span>
          <span className="text-(--demo-muted-fg)"><Ion name="chevron-forward" size={18} /></span>
        </button>

        <div className="mb-6 flex flex-wrap justify-between gap-y-2">
          {SHORTCUTS.map((s) => (
            <button key={s.label} onClick={() => tell(s.label)}
              className="flex w-[23.5%] flex-col items-center gap-1.5 rounded-lg border border-(--demo-border) bg-(--demo-card) py-3 text-(--demo-fg)">
              <Ion name={s.icon} size={22} />
              <span className="text-xs text-(--demo-muted-fg)">{s.label}</span>
            </button>
          ))}
        </div>

        <Section title="Workspace">
          <SettingsRow icon="business" label="My workspaces" border onPress={() => tell('My workspaces')} />
          <SettingsRow icon="stats-chart" label="Dashboard" border onPress={() => tell('The dashboard')} />
          <SettingsRow icon="pulse" label="Activity" onPress={() => tell('Activity')} />
        </Section>

        <Section title="Storage">
          <SettingsRow icon="server-outline" label="Storage used by cache" description="Thumbnails, opened files and temporary copies. Safe to clear."
            value="54.0 MB" onPress={() => tell('The cache')}
            right={<span className="ml-2 rounded-lg bg-(--demo-muted) px-3 py-1.5 text-sm text-(--demo-fg)">Clear</span>} />
        </Section>

        <Section title="Preferences">
          <SettingsRow icon="cloud-upload" label="Backup" value="On" border onPress={() => tell('Backup settings')} />
          <SettingsRow icon="notifications-outline" label="Notifications" border onPress={() => tell('Notification settings')} />
          <SettingsRow icon="contrast" label="Appearance" value="System" border onPress={() => tell('Appearance')} />
          <SettingsRow icon="shield-checkmark-outline" label="Security" description="Password, 2FA & biometric unlock" onPress={() => tell('Security')} />
        </Section>

        <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'This is a demo - sign up to get your own account', cta: true } })}
          className="w-full rounded-lg py-3 text-center text-base text-(--demo-primary)">Sign out</button>
        <p className="mt-2 text-center text-xs text-(--demo-muted-fg)">Version 1.0.0</p>
      </div>
    </>
  );
}

// ── Orbit tab bar ─────────────────────────────────────────────────────────

const TABS: { id: MobileTab; label: string; icon: IonName }[] = [
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'backup', label: 'Backup', icon: 'cloud-upload' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

// The orbit button's transfer arc: fraction of the in-flight uploads done.
function OrbitArc({ fraction }: { fraction: number }) {
  const inset = 1, stroke = 3;
  const r = ORBIT_SIZE / 2 - inset - stroke / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg className="pointer-events-none absolute inset-0" width={ORBIT_SIZE} height={ORBIT_SIZE} aria-hidden="true">
      <circle cx={ORBIT_SIZE / 2} cy={ORBIT_SIZE / 2} r={r} stroke="rgba(255,255,255,0.34)" strokeWidth={stroke} fill="none" />
      <circle cx={ORBIT_SIZE / 2} cy={ORBIT_SIZE / 2} r={r} stroke="var(--demo-primary-fg)" strokeWidth={stroke} strokeLinecap="round" fill="none"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - fraction)} transform={`rotate(-90 ${ORBIT_SIZE / 2} ${ORBIT_SIZE / 2})`}
        style={{ transition: 'stroke-dashoffset 90ms linear' }} />
    </svg>
  );
}

function OrbitTabBar({ tab, onTab, sheetOpen, onOrbit }: { tab: MobileTab; onTab: (t: MobileTab) => void; sheetOpen: boolean; onOrbit: () => void }) {
  const { state } = useDemo();
  const width = PHONE_W - BAR_PAD_X * 2;
  const geo = cradle({ width, height: ORBIT_SIZE, discCx: width - ORBIT_SIZE / 2, discR: ORBIT_SIZE / 2 });
  const uploading = state.uploads.length > 0;
  const fraction = uploading ? state.uploads.reduce((a, u) => a + u.progress, 0) / (state.uploads.length * 100) : 0;
  return (
    <nav aria-label="Tabs" className="bg-(--demo-bg) pb-[42px] pt-2" style={{ paddingLeft: BAR_PAD_X, paddingRight: BAR_PAD_X }}>
      <div className="relative" style={{ height: ORBIT_SIZE }}>
        <svg className="pointer-events-none absolute left-0 top-0" width={width} height={ORBIT_SIZE} aria-hidden="true">
          <path d={geo.path} fill="var(--demo-card)" stroke="var(--demo-border)" strokeWidth={1} />
        </svg>
        {/* `relative` so the icons paint above the absolutely positioned cradle surface. */}
        <div className="relative flex h-full items-center justify-around pl-1" style={{ paddingRight: geo.tabRight }}>
          {TABS.map((t) => {
            const focused = tab === t.id;
            return (
              <button key={t.id} data-testid={`orbit-tab-${t.id}`} aria-label={t.label} aria-current={focused ? 'page' : undefined} onClick={() => onTab(t.id)}
                className={`grid place-items-center rounded-full px-5 py-2 ${focused ? 'bg-(--demo-muted) text-(--demo-primary)' : 'text-(--demo-muted-fg)'}`}>
                <Ion name={t.icon} size={22} />
              </button>
            );
          })}
        </div>
        <button data-testid="orbit-button" aria-label={sheetOpen ? 'Close' : uploading ? `Uploading, ${Math.round(fraction * 100)}%` : 'Add'} aria-expanded={sheetOpen} onClick={onOrbit}
          className="absolute right-0 top-0 grid place-items-center rounded-full bg-(--demo-primary) text-(--demo-primary-fg)"
          style={{ width: ORBIT_SIZE, height: ORBIT_SIZE, boxShadow: '0 2px 3px rgba(0,0,0,0.18)' }}>
          <span className="pointer-events-none absolute inset-1 rounded-full border border-white/[.42]" />
          {uploading && !sheetOpen && <OrbitArc fraction={fraction} />}
          {sheetOpen ? <Ion name="close" size={26} /> : uploading ? (
            <span className="font-mono text-sm tabular-nums">{Math.round(fraction * 100)}%</span>
          ) : <Ion name="add" size={28} />}
        </button>
      </div>
    </nav>
  );
}

function OrbitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useDemo();
  // The app's sheet dismisses on the hardware back gesture; on a keyboard that is Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const pick = (name?: string) => {
    onClose();
    dispatch(name ? { type: 'START_UPLOAD', name, sizeBytes: 4_812_544 } : { type: 'START_UPLOAD' });
  };
  const sources: { icon: IonName; label: string; name?: string }[] = [
    { icon: 'camera-outline', label: 'Take photo', name: 'IMG_4821.HEIC' },
    { icon: 'images-outline', label: 'Choose photos', name: 'IMG_4790.jpg' },
    { icon: 'document-outline', label: 'Choose files' },
  ];
  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label="Add to workspace" data-testid="orbit-sheet" onClick={(e) => e.stopPropagation()}
        className="rounded-t-3xl bg-(--demo-card) pb-[34px]">
        <div className="flex items-center justify-center pb-1 pt-2.5"><span className="h-1 w-9 rounded-full bg-(--demo-border)" /></div>
        {state.uploads.length > 0 && (
          <div>
            <p className="px-4 pb-1.5 pt-3 font-mono text-[10.5px] uppercase tracking-[1.1px] text-(--demo-muted-fg)">{state.uploads.length === 1 ? 'Transfer' : 'Transfers'}</p>
            {state.uploads.map((u) => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-2 text-(--demo-muted-fg)">
                <Ion name="cloud-upload-outline" size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-(--demo-fg)">{u.name}</span>
                  <span className="block text-xs">{Math.round(u.progress)}% · {humanSize(u.sizeBytes)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className={`px-4 pb-1.5 pt-3 font-mono text-[10.5px] uppercase tracking-[1.1px] text-(--demo-muted-fg) ${state.uploads.length > 0 ? 'mt-2 border-t border-(--demo-border)' : ''}`}>
          Add to {DEMO_WORKSPACE.name}
        </p>
        {sources.map((s) => (
          <button key={s.label} onClick={() => pick(s.name)} className="flex w-full items-center gap-4 px-4 py-3 text-left text-(--demo-fg)">
            <Ion name={s.icon} size={22} />
            <span className="text-[17px]">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Body + frame ──────────────────────────────────────────────────────────

function MobileBody() {
  const [tab, setTab] = useState<MobileTab>('files');
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="demo-mobile relative flex flex-col bg-(--demo-bg) text-(--demo-fg)" style={{ width: PHONE_W, height: PHONE_H }}>
      <StatusBar />
      {tab === 'files' && <FilesTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'settings' && <SettingsTab />}
      <OrbitTabBar tab={tab} onTab={setTab} sheetOpen={sheetOpen} onOrbit={() => setSheetOpen((o) => !o)} />
      <OrbitSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {/* Home indicator */}
      <span className="pointer-events-none absolute bottom-2 left-1/2 z-30 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-(--demo-fg)/40" />

      <PreviewPane variant="sheet" />
      <Lightbox />
      <ShareModal />
      <DemoToast offset="bottom-[118px]" />
    </div>
  );
}

function Root() {
  const { state } = useDemo();
  return (
    <div className="demo-root mx-auto w-fit" data-demo-theme={state.theme} role="region"
      aria-label="Interactive dosya mobile app demo - sample data only">
      <ThemeBar />
      {/* iPhone 17 frame, drawn at device points and scaled to the page with zoom. */}
      <div className="relative mx-auto w-fit" style={{ zoom: 0.8 }}>
        <div className="rounded-[3.4rem] bg-gradient-to-b from-zinc-600 via-zinc-800 to-zinc-900 p-[3px] shadow-2xl">
          <div className="rounded-[3.3rem] bg-zinc-950 p-[10px]">
            <div className="relative overflow-hidden rounded-[2.7rem] bg-(--demo-bg)" style={{ width: PHONE_W }}>
              {/* Dynamic Island */}
              <div className="absolute left-1/2 top-[11px] z-40 h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" />
              <MobileBody />
            </div>
          </div>
        </div>
        {/* Side buttons on the frame */}
        <span className="absolute -left-[3px] top-[140px] h-8 w-[3px] rounded-l bg-zinc-700" />
        <span className="absolute -left-[3px] top-[196px] h-14 w-[3px] rounded-l bg-zinc-700" />
        <span className="absolute -left-[3px] top-[266px] h-14 w-[3px] rounded-l bg-zinc-700" />
        <span className="absolute -right-[3px] top-[220px] h-20 w-[3px] rounded-r bg-zinc-700" />
      </div>
    </div>
  );
}

interface MobileDemoProps {
  /** Restyles this demo instance to match a theme picked elsewhere on the page. */
  theme?: DemoThemeId;
  /** Overrides the toast's "Sign up free" link; null hides the link. */
  ctaHref?: string | null;
  /** Shows or hides the in-demo theme pickers. Defaults to true. */
  showThemeControls?: boolean;
}

export default function MobileDemo({ theme, ctaHref, showThemeControls }: MobileDemoProps = {}) {
  return (
    <DemoProvider theme={theme} ctaHref={ctaHref} showThemeControls={showThemeControls}>
      <Root />
    </DemoProvider>
  );
}

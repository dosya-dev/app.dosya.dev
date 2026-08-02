import { useState } from 'react';
import {
  Folder, CloudUpload, Settings as SettingsIcon, Search, ChevronsUpDown,
  ChevronRight, Plus, Check, User, Palette, Bell, HardDrive, LogOut,
} from 'lucide-react';
import { breadcrumbs, DemoProvider, useDemo, visibleItems } from './engine/demoState';
import { DemoToast } from './core/DemoToast';
import { PreviewPane } from './core/PreviewPane';
import { Lightbox } from './core/Lightbox';
import { ShareModal } from './core/ShareModal';
import { UploadLayer } from './core/UploadLayer';
import { ThemeBar } from './web/ThemeBar';
import { fileIconSrc, folderIconSrc, DEMO_WORKSPACE, type DemoFile } from './engine/demoData';
import './demo-themes.css';

type MobileTab = 'files' | 'backup' | 'settings';

// iPhone status bar: signal, wifi, battery (inline SVG).
function StatusBar() {
  return (
    <div className="relative z-30 flex items-center justify-between px-7 pt-3 pb-1 text-(--demo-fg)">
      <span className="text-[13px] font-semibold tracking-tight">9:41</span>
      <div className="flex items-center gap-1.5">
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor" aria-hidden="true">
          <rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" />
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
          <path d="M8 2.5c2.5 0 4.8 1 6.4 2.6l-1.4 1.4A7 7 0 0 0 8 4.5 7 7 0 0 0 3 6.5L1.6 5.1A9 9 0 0 1 8 2.5Zm0 4a5 5 0 0 1 3.5 1.4l-1.4 1.5A3 3 0 0 0 8 8.5a3 3 0 0 0-2.1.9L4.5 7.9A5 5 0 0 1 8 6.5Zm0 3.8 1.4 1.5-1.4 .2-1.4-.2 1.4-1.5Z" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none" aria-hidden="true">
          <rect x="0.5" y="0.5" width="21" height="11" rx="3" stroke="currentColor" strokeOpacity="0.4" />
          <rect x="2" y="2" width="16" height="8" rx="1.5" fill="currentColor" />
          <rect x="23" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" fillOpacity="0.5" />
        </svg>
      </div>
    </div>
  );
}

// Mirrors the mobile WorkspaceHeader: workspace switcher (name + plan) + search,
// shown on every tab. The active tab (bottom bar) indicates the section.
function MobileHeader({ onSearch }: { onSearch: () => void }) {
  const { dispatch } = useDemo();
  return (
    <div className="flex items-center gap-3 px-5 pt-1 pb-2">
      <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Switch workspaces in the full app', cta: true } })}
        className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
          style={{ background: DEMO_WORKSPACE.color }}>{DEMO_WORKSPACE.initials}</span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[15px] font-bold leading-tight text-(--demo-fg)">{DEMO_WORKSPACE.name}</span>
          <span className="block text-[11px] leading-tight text-(--demo-muted-fg)">Owner · Business</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-(--demo-muted-fg)" />
      </button>
      <button aria-label="Workspace settings" onClick={() => dispatch({ type: 'TOAST', toast: { text: 'Workspace settings in the full app', cta: true } })}
        className="shrink-0 text-(--demo-muted-fg)"><SettingsIcon className="size-5" /></button>
      <button aria-label="Search" onClick={onSearch} className="shrink-0 text-(--demo-muted-fg)"><Search className="size-5" /></button>
    </div>
  );
}

// iPhone-Albums-style square tile: photo/icon thumbnail + name below.
function MobileTile({ file }: { file: DemoFile }) {
  const { dispatch } = useDemo();
  const isPhoto = file.kind === 'image' && !!file.thumb;
  const isVideo = file.kind === 'video';
  return (
    <button data-demo-tile onClick={() => dispatch({ type: 'PREVIEW', fileId: file.id })} className="text-left">
      <span className="relative block aspect-square overflow-hidden rounded-xl ring-1 ring-black/5">
        {isPhoto || isVideo ? (
          <>
            <span className="absolute inset-0" style={{ background: file.thumb ?? 'linear-gradient(160deg,#334155,#0f172a)' }} />
            {isVideo && (
              <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45">
                <span className="ml-0.5 border-y-[5px] border-l-[8px] border-y-transparent border-l-white" />
              </span>
            )}
            {file.shared && <span className="absolute left-1 top-1 grid size-4 place-items-center rounded-full bg-black/45 text-[8px] text-white">↗</span>}
          </>
        ) : (
          <span className="grid h-full place-items-center bg-(--demo-muted)/50"><img src={fileIconSrc(file.name)} alt="" className="size-9" /></span>
        )}
      </span>
      <span className="mt-1 block truncate text-[11px] text-(--demo-fg)">{file.name}</span>
    </button>
  );
}

function MobileFiles() {
  const { state, dispatch } = useDemo();
  const { folders, files } = visibleItems(state);
  const hasChildren = (fid: string) =>
    state.files.some((x) => x.folderId === fid) || state.folders.some((x) => x.parentId === fid);
  return (
    <div className="grid grid-cols-2 gap-2.5 p-3">
      {folders.map((f) => (
        <button key={f.id} data-demo-tile onClick={() => dispatch({ type: 'NAVIGATE', folderId: f.id })} className="text-left">
          <span className="grid aspect-square place-items-center rounded-xl bg-(--demo-muted)/50">
            <img src={folderIconSrc(hasChildren(f.id))} alt="" className="size-14" />
          </span>
          <span className="mt-1 block truncate text-[11px] font-medium text-(--demo-fg)">{f.name}</span>
        </button>
      ))}
      {files.map((f) => <MobileTile key={f.id} file={f} />)}
    </div>
  );
}

function MobileBackup() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="grid size-24 place-items-center rounded-full border-4 border-(--demo-primary)">
        <Check className="size-10 text-(--demo-primary)" />
      </div>
      <p className="text-base font-bold">Backed up</p>
      <p className="text-xs text-(--demo-muted-fg)">1,284 photos · 214 videos safe in SYD</p>
      <span className="rounded-full bg-(--demo-primary)/10 px-3 py-1 text-[11px] font-semibold text-(--demo-primary)">Auto-backup on</span>
      <p className="mt-1 text-[11px] text-(--demo-muted-fg)">Last backup · just now over Wi-Fi</p>
    </div>
  );
}

function MobileSettings() {
  const { dispatch } = useDemo();
  const rows = [
    { icon: User, label: 'Account', sub: 'alex@acme.studio' },
    { icon: Palette, label: 'Appearance', sub: 'Theme & text size' },
    { icon: Bell, label: 'Notifications', sub: 'Uploads, shares, activity' },
    { icon: HardDrive, label: 'Storage', sub: '24.3 GB of 100 GB used' },
  ];
  return (
    <div className="p-3">
      <div className="overflow-hidden rounded-xl border border-(--demo-border) bg-(--demo-card)">
        {rows.map((r, i) => (
          <button key={r.label} onClick={() => dispatch({ type: 'TOAST', toast: { text: `${r.label} lives in the full app`, cta: true } })}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-(--demo-muted) ${i > 0 ? 'border-t border-(--demo-border)' : ''}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--demo-muted) text-(--demo-fg)"><r.icon className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium text-(--demo-fg)">{r.label}</span>
              <span className="block truncate text-[11px] text-(--demo-muted-fg)">{r.sub}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-(--demo-muted-fg)" />
          </button>
        ))}
      </div>
      <button onClick={() => dispatch({ type: 'TOAST', toast: { text: 'This is a demo - sign up to get your own account', cta: true } })}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-(--demo-border) py-2.5 text-[13px] font-medium text-(--demo-muted-fg) hover:bg-(--demo-muted)">
        <LogOut className="size-4" /> Log out
      </button>
    </div>
  );
}

const TABS: { id: MobileTab; label: string; icon: typeof Folder }[] = [
  { id: 'files', label: 'Files', icon: Folder },
  { id: 'backup', label: 'Backup', icon: CloudUpload },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function MobileBody() {
  const { state, dispatch } = useDemo();
  const [tab, setTab] = useState<MobileTab>('files');
  const trail = breadcrumbs(state);

  return (
    <div className="relative flex h-[648px] flex-col bg-(--demo-bg) text-(--demo-fg)">
      <StatusBar />
      <MobileHeader onSearch={() => dispatch({ type: 'TOAST', toast: { text: 'Search across everything in the full app', cta: true } })} />
      {tab === 'files' && trail.length > 0 && (
        <button className="flex items-center px-4 pb-1 text-left text-xs text-(--demo-primary)"
          onClick={() => dispatch({ type: 'NAVIGATE', folderId: trail.length > 1 ? trail[trail.length - 2].id : null })}>
          <ChevronRight className="size-3 rotate-180" /> Back
        </button>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'files' && <MobileFiles />}
        {tab === 'backup' && <MobileBackup />}
        {tab === 'settings' && <MobileSettings />}
      </div>

      {tab === 'files' && (
        <button aria-label="Upload" onClick={() => dispatch({ type: 'START_UPLOAD' })}
          className="absolute bottom-20 right-4 z-30 grid size-12 place-items-center rounded-full bg-(--demo-primary) text-(--demo-primary-fg) shadow-xl">
          <Plus className="size-6" />
        </button>
      )}
      <UploadLayer dragging={false} offset="bottom-20" />

      {/* Tab bar */}
      <nav className="flex border-t border-(--demo-border) bg-(--demo-card) px-2 pb-5 pt-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-md py-1 ${tab === id ? 'text-(--demo-primary)' : 'text-(--demo-muted-fg)'}`}>
            <Icon className="size-[22px]" strokeWidth={tab === id ? 2.4 : 2} />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </nav>
      {/* Home indicator */}
      <span className="pointer-events-none absolute bottom-1.5 left-1/2 h-1 w-32 -translate-x-1/2 rounded-full bg-(--demo-fg)/40" />

      <PreviewPane variant="sheet" />
      <Lightbox />
      <ShareModal />
      <DemoToast offset="bottom-24" />
    </div>
  );
}

function Root() {
  const { state } = useDemo();
  return (
    <div className="demo-root mx-auto w-fit" data-demo-theme={state.theme} role="region"
      aria-label="Interactive dosya mobile app demo - sample data only">
      <ThemeBar />
      {/* iPhone 17 Pro frame */}
      <div className="relative mx-auto w-fit">
        <div className="rounded-[3.4rem] bg-gradient-to-b from-zinc-600 via-zinc-800 to-zinc-900 p-[3px] shadow-2xl">
          <div className="rounded-[3.3rem] bg-zinc-950 p-[10px]">
            <div className="relative w-[316px] overflow-hidden rounded-[2.7rem] bg-(--demo-bg)">
              {/* Dynamic Island */}
              <div className="absolute left-1/2 top-2.5 z-40 h-[30px] w-[104px] -translate-x-1/2 rounded-full bg-black" />
              <MobileBody />
            </div>
          </div>
        </div>
        {/* Side buttons on the titanium frame */}
        <span className="absolute -left-[3px] top-[112px] h-7 w-[3px] rounded-l bg-zinc-700" />
        <span className="absolute -left-[3px] top-[156px] h-12 w-[3px] rounded-l bg-zinc-700" />
        <span className="absolute -left-[3px] top-[212px] h-12 w-[3px] rounded-l bg-zinc-700" />
        <span className="absolute -right-[3px] top-[176px] h-16 w-[3px] rounded-r bg-zinc-700" />
      </div>
    </div>
  );
}

export default function MobileDemo() {
  return (
    <DemoProvider>
      <Root />
    </DemoProvider>
  );
}

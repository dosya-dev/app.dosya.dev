import { useState, type DragEvent, type ReactNode } from 'react';
import { Inbox, Users, RefreshCw, Settings, type LucideIcon } from 'lucide-react';
import { DemoProvider, useDemo } from './engine/demoState';
import { DesktopShell } from './shells/DesktopShell';
import { DesktopSidebar } from './desktop/DesktopSidebar';
import { DesktopDashboard } from './desktop/DesktopDashboard';
import { UploadView } from './core/UploadView';
import { Toolbar } from './core/Toolbar';
import { FileList } from './core/FileList';
import { UploadLayer } from './core/UploadLayer';
import { ShareModal } from './core/ShareModal';
import { PreviewPane } from './core/PreviewPane';
import { Lightbox } from './core/Lightbox';
import { DemoToast } from './core/DemoToast';
import { humanSize, KIND_COLORS, SIGNUP_URL, type DemoThemeId } from './engine/demoData';
import './demo-themes.css';

export type DesktopView = 'dashboard' | 'files' | 'upload' | 'shared' | 'requests' | 'team' | 'sync' | 'settings';

const PLACEHOLDERS: Record<string, { icon: LucideIcon; title: string; blurb: string }> = {
  requests: { icon: Inbox, title: 'File requests', blurb: 'Collect files from anyone with a secure upload link.' },
  team: { icon: Users, title: 'Team', blurb: 'Invite teammates and manage roles across your workspace.' },
  sync: { icon: RefreshCw, title: 'Folder sync', blurb: 'Keep local folders mirrored to dosya, two ways, in real time.' },
  settings: { icon: Settings, title: 'Settings', blurb: 'Appearance, security, storage and more.' },
};

function Main({ view, onSelect }: { view: DesktopView; onSelect: (id: string) => void }) {
  const { state, dispatch } = useDemo();
  const [dragging, setDragging] = useState(false);

  function onDragOver(e: DragEvent) { e.preventDefault(); setDragging(true); }
  function onDragLeave(e: DragEvent) { if (e.currentTarget === e.target) setDragging(false); }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).slice(0, 3);
    if (files.length === 0) dispatch({ type: 'START_UPLOAD' });
    for (const f of files) dispatch({ type: 'START_UPLOAD', name: f.name, sizeBytes: f.size || undefined });
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-(--demo-bg) text-sm text-(--demo-fg)"
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'dashboard' && <DesktopDashboard onNavigate={onSelect} />}
        {view === 'files' && (
          <div className="flex h-full flex-col">
            <Toolbar />
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
              {state.tab === 'files' ? <FileList /> : null}
            </div>
          </div>
        )}
        {view === 'upload' && <UploadView dragging={dragging} />}
        {view === 'shared' && <SharedView />}
        {(view === 'requests' || view === 'team' || view === 'sync' || view === 'settings') && (
          <Placeholder {...PLACEHOLDERS[view]} />
        )}
      </div>
      {/* On the Upload page the inline queue shows progress, so skip the floating dock. */}
      {view !== 'upload' && <UploadLayer dragging={dragging} />}
      <ShareModal />
      <PreviewPane variant="panel" />
      <Lightbox />
      <DemoToast />
    </div>
  );
}

function SharedView() {
  const { state, dispatch } = useDemo();
  const shared = state.files.filter((f) => f.shared);
  return (
    <div className="p-5">
      <h1 className="mb-1 text-xl font-semibold">Shared</h1>
      <p className="mb-4 text-sm text-(--demo-muted-fg)">Files you've shared with a public link.</p>
      {shared.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--demo-muted-fg)">Nothing shared yet - open a file and hit Share.</p>
      ) : (
        <div className="space-y-1">
          {shared.map((f) => (
            <button key={f.id} onClick={() => dispatch({ type: 'OPEN_SHARE', fileId: f.id })}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-(--demo-muted)">
              <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[f.kind] }} />
              <span className="flex-1 truncate text-sm">{f.name}</span>
              <span className="rounded-full bg-(--demo-primary)/10 px-2 py-0.5 text-[10px] font-semibold text-(--demo-primary)">
                Link active
              </span>
              <span className="text-xs text-(--demo-muted-fg)">{humanSize(f.sizeBytes)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Placeholder({ icon: Icon, title, blurb }: { icon: LucideIcon; title: string; blurb: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-xs">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-(--demo-muted) text-(--demo-muted-fg)">
          <Icon size={22} />
        </div>
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1 text-sm text-(--demo-muted-fg)">{blurb}</p>
        <a href={SIGNUP_URL} className="mt-3 inline-block rounded-lg bg-(--demo-primary) px-4 py-2 text-xs font-semibold text-(--demo-primary-fg) hover:opacity-90">
          Sign up free to use it
        </a>
      </div>
    </div>
  );
}

function Root() {
  const { state, dispatch } = useDemo();
  const [view, setView] = useState<DesktopView>('dashboard');

  function onSelect(id: string) {
    switch (id) {
      case 'dashboard': case 'files': case 'upload': case 'shared':
      case 'requests': case 'team': case 'sync': case 'settings':
        setView(id);
        break;
      case 'activity':
        dispatch({ type: 'TOAST', toast: { text: 'See the full activity log in the app', cta: true } });
        break;
      case 'workspace':
        dispatch({ type: 'TOAST', toast: { text: 'Switch between workspaces in the full app', cta: true } });
        break;
      case 'search':
        dispatch({ type: 'TOAST', toast: { text: 'Search across everything in the full app', cta: true } });
        break;
      case 'logout':
        dispatch({ type: 'TOAST', toast: { text: 'This is a demo - sign up to get your own workspace', cta: true } });
        break;
    }
  }

  return (
    <div className="demo-root mx-auto max-w-5xl" data-demo-theme={state.theme} role="region"
      aria-label="Interactive dosya desktop app demo - sample data only">
      <DesktopShell>
        <DesktopSidebar view={view} onSelect={onSelect} />
        <Main view={view} onSelect={onSelect} />
      </DesktopShell>
    </div>
  );
}

interface DesktopDemoProps {
  /** Restyles this demo instance to match a theme picked elsewhere on the page. */
  theme?: DemoThemeId;
  /** Overrides the toast's "Sign up free" link; null hides the link. */
  ctaHref?: string | null;
  /** Shows or hides the in-demo theme pickers. Defaults to true. */
  showThemeControls?: boolean;
}

export default function DesktopDemo({ theme, ctaHref, showThemeControls }: DesktopDemoProps = {}): ReactNode {
  return (
    <DemoProvider theme={theme} ctaHref={ctaHref} showThemeControls={showThemeControls}>
      <Root />
    </DemoProvider>
  );
}

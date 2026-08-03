import {
  ArrowRight, RefreshCw, HardDrive, Server, Cloud, Monitor, Terminal,
  Code2, Webhook, CloudDownload, type LucideIcon,
} from 'lucide-react';
import { useDemo } from '../engine/demoState';

// Mirrors apps/web integrations page (INTEGRATIONS list) so visitors see
// exactly which tools connect to dosya.
const INTEGRATIONS: { title: string; description: string; tag: string; icon: LucideIcon; iconSrc?: string }[] = [
  { title: 'rclone', description: 'Copy, sync and mount your files from the command line with rclone.', tag: 'Sync & mount', icon: RefreshCw },
  { title: 'WebDAV', description: 'Mount your workspace as a network drive on macOS, Windows or Linux.', tag: 'Mount as drive', icon: HardDrive },
  { title: 'SFTP', description: 'Upload and manage files with any SFTP client - FileZilla, WinSCP, Cyberduck or the terminal.', tag: 'Secure transfer', icon: Server },
  { title: 'S3', description: 'Point any S3-compatible tool or SDK at your workspace.', tag: 'S3 API', icon: Cloud },
  { title: 'Desktop apps', description: 'Download the desktop app for macOS, Windows and Linux.', tag: 'Apps', icon: Monitor },
  { title: 'CLI', description: 'Script uploads, downloads and folder sync from your terminal with the dosya CLI.', tag: 'Terminal', icon: Terminal },
  { title: 'REST API', description: 'Automate everything with the dosya REST API and bearer tokens.', tag: 'HTTP API', icon: Code2 },
  { title: 'Google Drive', description: 'Import files directly from your Google Drive into a workspace.', tag: 'Import', icon: HardDrive, iconSrc: '/google-color.svg' },
  { title: 'Webhooks', description: 'Get realtime HTTP notifications when files are uploaded, deleted, or shares are accessed.', tag: 'Events', icon: Webhook },
  { title: 'Remote download', description: 'Paste a direct file link and dosya downloads it into your workspace server-side - ideal on slow connections.', tag: 'Import', icon: CloudDownload },
];

export function WebIntegrations() {
  const { dispatch } = useDemo();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Integrations</h1>
        <p className="mt-0.5 text-sm text-(--demo-muted-fg)">Connect external tools and apps to your dosya workspace.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INTEGRATIONS.map((it) => (
          <button key={it.title}
            onClick={() => dispatch({ type: 'TOAST', toast: { text: `Set up ${it.title} in the full app`, cta: true } })}
            className="group relative flex flex-col rounded-xl border border-(--demo-border) bg-(--demo-card) p-4 text-left transition-colors hover:border-(--demo-fg)/20 hover:bg-(--demo-muted)/40">
            <div className="mb-3 flex items-center justify-between">
              <div className="grid size-9 place-items-center rounded-lg bg-(--demo-muted)">
                {it.iconSrc ? <img src={it.iconSrc} alt="" className="size-4.5" /> : <it.icon className="size-4.5 text-(--demo-fg)" />}
              </div>
              <ArrowRight className="size-4 -translate-x-1 text-(--demo-muted-fg) opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
            </div>
            <p className="text-sm font-semibold">{it.title}</p>
            <p className="mt-1 flex-1 text-xs text-(--demo-muted-fg)">{it.description}</p>
            <span className="mt-3 inline-flex w-fit items-center rounded-full bg-(--demo-muted) px-2 py-0.5 text-[10px] font-medium text-(--demo-muted-fg)">{it.tag}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

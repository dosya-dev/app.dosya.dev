import { FolderSync, Globe, Network, Server, SquareTerminal, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RcloneBackend } from '@/api/rclone-import';
import { BRAND_ICONS, CATEGORY_HUE, monogram } from './form-model';

/** Protocols are not brands; they get a drawn icon from the app's own set. */
const PROTOCOL_ICONS: Record<string, LucideIcon> = {
  sftp: SquareTerminal,
  ftp: Server,
  smb: Network,
  webdav: FolderSync,
  http: Globe,
};

/** A service's icon: its brand mark, a protocol icon, or a two-letter mark tinted by category. */
export function ServiceMark({ backend, size = 'md', className }: {
  backend: Pick<RcloneBackend, 'name' | 'label' | 'category'>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const box = size === 'md' ? 'size-8' : 'size-7';
  const glyph = size === 'md' ? 'size-[18px]' : 'size-4';

  if (BRAND_ICONS.has(backend.name)) {
    // A white tile in both themes: brand marks are drawn for a light ground,
    // and several (Filen, Akamai, Uloz.to) are near-black.
    return (
      <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-lg border border-black/[0.06] bg-white', box, className)}>
        <img src={`/rclone-icons/${backend.name}.webp`} alt="" width={18} height={18} loading="lazy" decoding="async" className={cn('object-contain', glyph)} />
      </span>
    );
  }

  const Icon = PROTOCOL_ICONS[backend.name];
  if (Icon) {
    return (
      <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/75', box, className)}>
        <Icon className={glyph} strokeWidth={1.75} />
      </span>
    );
  }

  const hue = CATEGORY_HUE[backend.category] ?? 'var(--muted-foreground)';
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-lg font-semibold tracking-tight', box, size === 'md' ? 'text-[12px]' : 'text-[11px]', className)}
      style={{ color: hue, background: `color-mix(in oklch, ${hue} 13%, transparent)` }}
    >
      {monogram(backend.name, backend.label)}
    </span>
  );
}

import { Laptop, Monitor, Smartphone, Terminal, HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import type { VpnPlatform } from '@/api/vpn';

/** Two-letter country code on a grey tile (design §4: codes, not flags). */
export function CountryTile({ country, className }: { country: string; className?: string }) {
  return (
    <span aria-hidden className={cn('flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted font-mono text-[11px] font-bold', className)}>
      {country}
    </span>
  );
}

/** Status pill. Every state has words, never colour alone. */
export function StatusPill({ status, elapsed }: { status: string; elapsed?: string }) {
  const t = useT();
  if (status === 'up') {
    return (
      <span className="inline-flex w-max items-center gap-1.5 rounded-full bg-[var(--tone-yes-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--brand-text)]">
        <span className="size-1.5 rounded-full bg-[var(--brand)]" aria-hidden />
        {t('vpn.status.ready')}
      </span>
    );
  }
  const text = status === 'booting'
    ? (elapsed ? t('vpn.status.startingElapsed', { elapsed }) : t('vpn.status.starting'))
    : status === 'off' ? t('vpn.status.offAboutTwoMinutes')
    : status === 'stopping' ? t('vpn.status.restarting')
    : status === 'failed' ? t('vpn.status.couldNotStart')
    : t('vpn.status.unknown');
  return (
    <span className="inline-flex w-max items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {status === 'booting' && <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-border border-t-foreground motion-reduce:animate-none" aria-hidden />}
      {text}
    </span>
  );
}

export function PlatformIcon({ platform }: { platform: string }) {
  const Icon = ({ ios: Smartphone, android: Smartphone, macos: Laptop, windows: Monitor, linux: Terminal } as Record<string, typeof Smartphone>)[platform] ?? HardDrive;
  return <Icon className="size-[18px]" aria-hidden />;
}

export const PLATFORM_CHOICES: Array<{ value: VpnPlatform; label: 'vpn.label.platformIos' | 'vpn.label.platformAndroid' | 'vpn.label.platformMac' | 'vpn.label.platformWindows' | 'vpn.label.platformLinux' | 'vpn.label.platformOther' }> = [
  { value: 'ios', label: 'vpn.label.platformIos' },
  { value: 'android', label: 'vpn.label.platformAndroid' },
  { value: 'macos', label: 'vpn.label.platformMac' },
  { value: 'windows', label: 'vpn.label.platformWindows' },
  { value: 'linux', label: 'vpn.label.platformLinux' },
  { value: 'config', label: 'vpn.label.platformOther' },
];

export function formatGb(bytes: number): string {
  return (bytes / 1_073_741_824).toFixed(bytes < 10 * 1_073_741_824 ? 1 : 0);
}

export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

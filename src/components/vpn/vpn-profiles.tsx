import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { renderAllProfiles, zipFiles } from '@/lib/vpn-config';
import type { VpnDevice, VpnLocation } from '@/api/vpn';
import { CountryTile } from './vpn-parts';

/**
 * QR code per location plus "Download all". Holds the device's private key only
 * in memory, for as long as this component is mounted.
 */
export function ProfilePicker({ privateKey, device, locations, dns, selected, onSelect }: {
  privateKey: string;
  device: Pick<VpnDevice, 'address_v4' | 'address_v6'>;
  locations: VpnLocation[];
  dns: string[];
  selected: string;
  onSelect: (code: string) => void;
}) {
  const t = useT();
  const profiles = useMemo(() => renderAllProfiles(privateKey, device, locations, dns), [privateKey, device, locations, dns]);
  const current = profiles.find((p) => p.filename === `dosya-${selected}.conf`) ?? profiles[0];
  const effective = current ? current.filename.replace(/^dosya-/, '').replace(/\.conf$/, '') : selected;
  // Keep the parent's choice equal to the profile actually shown ("I've scanned it" starts that one).
  useEffect(() => { if (effective !== selected) onSelect(effective); }, [effective, selected, onSelect]);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!current) return;
    // Dark on white with a quiet zone, so phones read it in dark mode too.
    QRCode.toString(current.text, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#181818', light: '#ffffff' } })
      .then((s) => { if (alive) setSvg(s); })
      .catch(() => { if (alive) setSvg(null); });
    return () => { alive = false; };
  }, [current]);

  function downloadAll() {
    const blob = new Blob([zipFiles(profiles) as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dosya-vpn-profiles.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="grid gap-6 sm:grid-cols-[220px_1fr]">
      <div className="aspect-square w-full max-w-[220px] rounded-2xl border bg-white p-3" data-testid="vpn-qr">
        {svg && <img alt={t('vpn.label.qrCodeForTheProfile')} className="h-full w-full" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />}
      </div>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('vpn.label.profileFor')}
          <select
            className="h-[38px] rounded-[10px] border bg-background px-3 text-sm font-normal normal-case tracking-normal text-foreground"
            value={effective}
            onChange={(e) => onSelect(e.target.value)}
          >
            {locations.filter((l) => l.server_public_key).map((l) => (
              <option key={l.code} value={l.code}>{t('vpn.label.countryCity', { country: countryName(l.country), city: l.city })}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 text-sm">
          {current && <CountryTile country={locations.find((l) => `dosya-${l.code}.conf` === current.filename)?.country ?? ''} />}
          <span className="font-mono text-xs text-muted-foreground">{current?.filename}</span>
        </div>
        <Button variant="outline" className="w-fit" onClick={downloadAll}>
          <Download className="size-4" aria-hidden />
          {t('vpn.action.downloadAllLocations', { count: profiles.length })}
        </Button>
      </div>
    </div>
  );
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

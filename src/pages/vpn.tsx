import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT, currentLocale } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { advanceGuide, idleGuide, startGuide, type GuideState } from '@/lib/vpn-guide';
import { deleteDevice, getVpn, isFailure, startLocation, type VpnDevice, type VpnLocation, type VpnStatus } from '@/api/vpn';
import { AddDeviceDialog, ConfirmRemoveDialog, GetProfilesDialog } from '@/components/vpn/vpn-dialogs';
import { countryName } from '@/components/vpn/vpn-profiles';
import { CountryTile, PlatformIcon, StatusPill, formatElapsed, formatGb } from '@/components/vpn/vpn-parts';

/*
 * Dosya VPN, Phase 1 (design: docs/superpowers/specs/2026-11-25-dosya-vpn-design.md §6).
 *
 * A setup page, not a connect button: a browser cannot run the tunnel. The user
 * adds a device (key made in the browser, only the public half sent), imports
 * its profiles into the free WireGuard app, starts a location here, then turns
 * the tunnel on. Every value comes from GET /api/vpn.
 */

export const VPN_QUERY_KEY = ['vpn'] as const;
const LAST_LOCATION_KEY = 'dosya.vpn.lastLocation';
const FAST_POLL_MS = 3000;
const SLOW_POLL_MS = 15000;
const LIVE_HANDSHAKE_SECONDS = 180;
const REGIONS = ['europe', 'americas', 'asia_pacific', 'middle_east_africa'] as const;
const nowSec = () => Math.floor(Date.now() / 1000);

export default function VpnPage() {
  const t = useT();
  const qc = useQueryClient();
  const [guide, setGuide] = useState<GuideState>(idleGuide);
  const [banner, setBanner] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [profilesFor, setProfilesFor] = useState<VpnDevice | null>(null);
  const [removing, setRemoving] = useState<VpnDevice | null>(null);
  const [now, setNow] = useState(nowSec);
  const guideActive = guide.phase === 'starting' || guide.phase === 'ready';

  const query = useQuery({
    queryKey: VPN_QUERY_KEY,
    queryFn: async () => {
      const r = await getVpn();
      if (isFailure(r)) throw r;
      return r;
    },
    refetchInterval: (q) => {
      const d = q.state.data as VpnStatus | undefined;
      const busy = d?.locations.some((l) => l.status === 'booting' || l.status === 'stopping');
      return busy || guideActive ? FAST_POLL_MS : SLOW_POLL_MS;
    },
  });
  const data = query.data;
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: VPN_QUERY_KEY }), [qc]);

  // A clock for elapsed timers and the guide's hint/timeout rules.
  useEffect(() => {
    if (!guideActive) return;
    const id = setInterval(() => setNow(nowSec()), 1000);
    return () => clearInterval(id);
  }, [guideActive]);

  // Advance the guide on every poll and tick. A poll fetched before Start says nothing about it.
  const fetchedAt = Math.floor(query.dataUpdatedAt / 1000);
  useEffect(() => {
    if (!data) return;
    setGuide((g) => advanceGuide(g, data, now, fetchedAt));
  }, [data, now, fetchedAt]);

  // `stopping` / `off` while starting: ask again (at most every 10 s).
  const lastRestart = useRef(0);
  useEffect(() => {
    if (guide.phase === 'starting' && guide.restart && now - lastRestart.current >= 10) {
      lastRestart.current = now;
      const code = guide.code;
      void startLocation(code).then((res) => {
        // A refusal or "servers busy" ends the guide instead of asking again every 10 s.
        if (isFailure(res)) { setBanner(startProblem(t, res.reason, res.error)); setGuide(idleGuide); return; }
        if (res.status !== 'booting' && res.status !== 'up' && res.status !== 'off' && res.status !== 'stopping') {
          setGuide(startGuide(code, nowSec(), null, res.status));
        }
        refresh();
      });
    }
  }, [guide, now, refresh, t]);

  // Quiet pre-warm: start the last-used location when the page opens. Never starts the guide.
  const prewarmed = useRef(false);
  useEffect(() => {
    if (!data || prewarmed.current || !data.entitled || data.devices.length === 0) return;
    prewarmed.current = true;
    const last = localStorage.getItem(LAST_LOCATION_KEY);
    if (last && data.locations.find((l) => l.code === last)?.status === 'off') void startLocation(last).then(refresh);
  }, [data, refresh]);

  async function start(code: string, watch: string | null = null) {
    setBanner(null);
    localStorage.setItem(LAST_LOCATION_KEY, code);
    const res = await startLocation(code);
    if (isFailure(res)) { setBanner(startProblem(t, res.reason, res.error)); return; }
    lastRestart.current = nowSec();
    setNow(nowSec());
    setGuide(startGuide(code, nowSec(), watch, res.status));
    refresh();
  }

  async function confirmRemove() {
    const d = removing;
    setRemoving(null);
    if (!d) return;
    const res = await deleteDevice(d.id);
    if (isFailure(res)) setBanner(res.error);
    refresh();
  }

  if (query.isLoading) return <div className="mx-auto max-w-6xl p-4 md:p-6 text-sm text-muted-foreground">{t('vpn.label.loading')}</div>;
  if (query.isError || !data) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <p role="alert" className="text-sm text-destructive">{t('vpn.error.couldNotLoad')}</p>
        <Button variant="outline" className="mt-3" onClick={() => query.refetch()}>{t('vpn.action.tryAgain')}</Button>
      </div>
    );
  }

  const lastUsed = localStorage.getItem(LAST_LOCATION_KEY) ?? data.locations.find((l) => l.status === 'up')?.code ?? data.locations[0]?.code ?? 'de';
  const canConnect = data.entitled;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{t('vpn.heading.vpn')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('vpn.description.pageIntro')}</p>
        </div>
        {canConnect && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            {t('vpn.action.addADevice')}
          </Button>
        )}
      </header>

      {!canConnect && <UpgradeCard reason={data.reason} />}
      {canConnect && <GuideStrip guide={guide} locations={data.locations} now={now} onRetry={(code) => start(code)} />}
      {banner && <p role="alert" className="rounded-xl border px-4 py-3 text-sm">{banner}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <LocationsCard locations={data.locations} canStart={canConnect} guide={guide} now={now} onStart={(code) => start(code)} />
        <div className="space-y-5">
          <DevicesCard
            devices={data.devices}
            canGetProfiles={canConnect}
            onGetProfiles={setProfilesFor}
            onRemove={setRemoving}
            empty={canConnect ? t('vpn.description.noDevicesYet') : null}
          />
          {canConnect && <UsageCard used={data.usage.usedBytes} cap={data.usage.capBytes} />}
        </div>
      </div>

      <AddDeviceDialog
        open={adding}
        onOpenChange={setAdding}
        locations={data.locations}
        dns={data.dns}
        defaultLocation={lastUsed}
        onCreated={refresh}
        onScanned={(deviceId, code) => void start(code, deviceId)}
      />
      <GetProfilesDialog device={profilesFor} onOpenChange={(o) => { if (!o) setProfilesFor(null); }} locations={data.locations} dns={data.dns} defaultLocation={lastUsed} />
      <ConfirmRemoveDialog device={removing} onCancel={() => setRemoving(null)} onConfirm={confirmRemove} />
    </div>
  );
}

function startProblem(t: ReturnType<typeof useT>, reason: string | undefined, fallback: string): string {
  switch (reason) {
    case 'no_device': return t('vpn.error.addADeviceFirst');
    case 'start_limit': return t('vpn.error.startLimit');
    default: return fallback;
  }
}

function GuideStrip({ guide, locations, now, onRetry }: { guide: GuideState; locations: VpnLocation[]; now: number; onRetry: (code: string) => void }) {
  const t = useT();
  const loc = 'code' in guide ? locations.find((l) => l.code === guide.code) : undefined;
  const place = loc ? countryName(loc.country) : '';
  const step = guide.phase === 'starting' ? 1 : guide.phase === 'ready' ? 2 : guide.phase === 'connected' ? 3 : 0;
  let line: string;
  switch (guide.phase) {
    case 'idle': line = t('vpn.guide.idle'); break;
    case 'starting': line = t('vpn.guide.startingPlaceLive', { place }); break;
    case 'ready': line = guide.hint ? t('vpn.guide.toggleHint') : t('vpn.guide.readyTurnOn'); break;
    case 'connected': line = t('vpn.guide.connectedDevice', { name: guide.deviceName }); break;
    case 'timeout': line = t('vpn.guide.timeout'); break;
    case 'problem':
      line = guide.problem === 'capacity' ? t('vpn.guide.capacity')
        : guide.problem === 'budget' ? t('vpn.guide.budget')
        : guide.problem === 'failed' ? t('vpn.guide.failedPlace', { place })
        : t('vpn.guide.unknown');
  }
  const steps = [t('vpn.guide.stepStart'), t('vpn.guide.stepTurnOn'), t('vpn.guide.stepConnected')];
  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border bg-card px-6 py-4">
      <ol className="flex flex-wrap items-center gap-4">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = step > n || (step === 3 && n === 3);
          const current = step === n && step !== 3;
          return (
            <li key={n} className={cn('flex items-center gap-2.5 text-sm', current && 'font-semibold')}>
              <span className={cn('flex size-6 items-center justify-center rounded-full border text-xs font-semibold', done && 'border-foreground bg-foreground text-background')}>
                {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : n}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <p className="text-sm text-muted-foreground sm:ms-auto">
        {/* Only the phase message is announced; the ticking timer stays outside the live region. */}
        <span role="status" aria-live="polite">{line}</span>
        {guide.phase === 'starting' && <span className="ms-2 font-mono text-xs" aria-hidden>{formatElapsed(now - guide.startedAt)}</span>}
      </p>
      {(guide.phase === 'timeout' || guide.phase === 'problem') && <Button variant="outline" size="sm" onClick={() => onRetry(guide.code)}>{t('vpn.action.tryAgain')}</Button>}
    </section>
  );
}

function LocationsCard({ locations, canStart, guide, now, onStart }: { locations: VpnLocation[]; canStart: boolean; guide: GuideState; now: number; onStart: (code: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const shown = locations.filter((l) => !needle || `${countryName(l.country)} ${l.city} ${l.country}`.toLowerCase().includes(needle));
    const known = new Set<string>(REGIONS);
    return [...REGIONS.map((r) => [r, shown.filter((l) => l.region === r)] as const), ['other', shown.filter((l) => !known.has(l.region))] as const]
      .filter(([, ls]) => ls.length > 0);
  }, [locations, q]);
  const regionLabel = (r: string) => ({
    europe: t('vpn.label.regionEurope'), americas: t('vpn.label.regionAmericas'),
    asia_pacific: t('vpn.label.regionAsiaPacific'), middle_east_africa: t('vpn.label.regionMiddleEastAfrica'),
  } as Record<string, string>)[r] ?? t('vpn.label.regionOther');

  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">{t('vpn.heading.locations')}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t('vpn.description.locationsExplain')}</p>
      <label className="mt-4 flex h-[38px] items-center gap-2 rounded-[10px] border px-3 text-sm">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <span className="sr-only">{t('vpn.label.searchLocations')}</span>
        <Input className="h-auto border-0 p-0 shadow-none focus-visible:ring-0" value={q} placeholder={t('vpn.label.searchLocationsPlaceholder', { count: locations.length })} onChange={(e) => setQ(e.target.value)} />
      </label>
      {groups.map(([region, ls]) => (
        <div key={region} className="mt-5">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{regionLabel(region)}</h3>
          <ul>
            {ls.map((l) => {
              const elapsed = guide.phase === 'starting' && guide.code === l.code ? formatElapsed(now - guide.startedAt) : undefined;
              return (
                <li key={l.code} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 border-t py-2.5 sm:grid-cols-[32px_1fr_170px_110px]" data-testid={`vpn-location-${l.code}`}>
                  <CountryTile country={l.country} />
                  <div>
                    <div className="text-sm">{countryName(l.country)}</div>
                    <div className="text-xs text-muted-foreground">{l.city}</div>
                  </div>
                  <StatusPill status={l.status} elapsed={elapsed} />
                  {canStart ? (
                    <Button variant="outline" size="sm" className="col-start-3 sm:col-start-auto" disabled={l.status === 'booting' || l.status === 'stopping'} onClick={() => onStart(l.code)}>
                      {l.status === 'up' ? t('vpn.action.connect') : t('vpn.action.start')}
                    </Button>
                  ) : <span className="hidden sm:block" />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function DevicesCard({ devices, canGetProfiles, onGetProfiles, onRemove, empty }: {
  devices: VpnDevice[];
  canGetProfiles: boolean;
  onGetProfiles: (d: VpnDevice) => void;
  onRemove: (d: VpnDevice) => void;
  empty: string | null;
}) {
  const t = useT();
  if (devices.length === 0 && empty === null) return null;
  const now = nowSec();
  const rel = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' });
  const when = (ts: number | null) => {
    if (ts === null) return t('vpn.label.notConnectedYet');
    const ago = now - ts;
    if (ago < LIVE_HANDSHAKE_SECONDS) return t('vpn.label.connectedNow');
    const span = ago < 3600 ? rel.format(-Math.round(ago / 60), 'minute') : ago < 86400 ? rel.format(-Math.round(ago / 3600), 'hour') : rel.format(-Math.round(ago / 86400), 'day');
    return t('vpn.label.lastConnected', { when: span });
  };
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">{t('vpn.heading.yourDevices')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('vpn.description.devicesExplain')}</p>
      {devices.length === 0 && empty && <p className="mt-4 text-sm text-muted-foreground">{empty}</p>}
      <ul className="mt-3">
        {devices.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 border-t py-3" data-testid={`vpn-device-${d.id}`}>
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-muted"><PlatformIcon platform={d.platform} /></span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.name}</div>
              <div className="text-xs text-muted-foreground">{when(d.last_handshake_at)}</div>
            </div>
            {canGetProfiles && <Button variant="ghost" size="sm" onClick={() => onGetProfiles(d)}>{t('vpn.action.getProfiles')}</Button>}
            <Button variant="ghost" size="sm" onClick={() => onRemove(d)}>{t('vpn.action.remove')}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsageCard({ used, cap }: { used: number; cap: number }) {
  const t = useT();
  const d = new Date();
  const reset = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const resetText = new Intl.DateTimeFormat(currentLocale(), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(reset);
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">{t('vpn.heading.thisMonth')}</h2>
      <p className="mt-3 text-2xl font-bold tracking-tight">
        {t('vpn.label.usageAmount', { used: formatGb(used) })}{' '}
        <span className="text-sm font-medium text-muted-foreground">{t('vpn.label.usageOfCap', { cap: formatGb(cap) })}</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={t('vpn.label.usageMeter')}>
        <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{t('vpn.description.usageResets', { date: resetText })}</p>
    </section>
  );
}

function UpgradeCard({ reason }: { reason: string }) {
  const t = useT();
  const text = reason === 'free_plan' ? t('vpn.description.upgradeFreePlan')
    : reason === 'grace_period' ? t('vpn.description.upgradeGracePeriod')
    : reason === 'fair_use' ? t('vpn.description.upgradeFairUse')
    : t('vpn.description.upgradeUnavailable');
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card px-6 py-5" data-testid="vpn-upgrade">
      <p className="text-sm leading-relaxed">{text}</p>
      {reason === 'free_plan' && <Button nativeButton={false} render={<a href="/billing" />}>{t('vpn.action.seePlans')}</Button>}
      {reason === 'grace_period' && <Button nativeButton={false} render={<a href="/billing" />}>{t('vpn.action.updatePayment')}</Button>}
    </section>
  );
}

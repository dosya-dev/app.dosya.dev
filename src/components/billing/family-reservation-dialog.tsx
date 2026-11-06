import { useState, type ReactNode } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { apiErrorBody, apiErrorMessage } from '@/api/client';
import { GB, setFamilyReservation, type FamilyMemberView } from '@/api/family';
import { formatGigabytes } from '@/lib/billing/cart-math';
import { sizeUnits } from '@/lib/format-locale';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { cn } from '@/lib/utils';
import { tint } from './family-colors';

/** One person in the pool, for the preview bar: their colour, what they use and what is reserved for them. */
export type ReservationPerson = { key: string; name: string; color: string; used: number; reserved: number | null };

const STEP_GB = 10;
/** Whole GB as a size; 0 stays "0 GB" (formatGigabytes would fall back to MB). */
const size = (gb: number) => (gb >= 1 ? formatGigabytes(gb * GB) : `0 ${sizeUnits().GB}`);

/**
 * Reserve storage for a family member, or change or remove their reservation.
 * A reservation is held for that person (nobody else can use it) and is also
 * their limit. Whole GB only. The most that fits comes from the view's
 * `max_reservable_bytes`; the server re-checks atomically and, when it refuses
 * with a 409, its own `max_gb` replaces ours. Lowering is always allowed, even
 * when the pool is overbooked, so the limit is never below the current amount.
 */
export function FamilyReservationDialog({ open, member, personKey, people, poolLimit, onClose, onSaved }: {
  open: boolean;
  member: FamilyMemberView;
  /** Which entry of `people` is this member. */
  personKey: string;
  people: ReservationPerson[];
  poolLimit: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const name = member.name ?? member.email;
  const me = people.find((p) => p.key === personKey);
  const used = member.used_bytes ?? me?.used ?? 0;
  const currentGb = member.reserved_bytes ? Math.round(member.reserved_bytes / GB) : null;
  const [serverMaxGb, setServerMaxGb] = useState<number | null>(null);
  const maxGb = serverMaxGb ?? Math.floor((member.max_reservable_bytes ?? 0) / GB);
  const limitGb = Math.max(maxGb, currentGb ?? 0);
  const [raw, setRaw] = useState(() => String(currentGb ?? (limitGb >= 100 ? 100 : Math.max(1, limitGb))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const v = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const valid = Number.isSafeInteger(v) && v >= 1;
  const over = valid && v > limitGb;
  const below = valid && !over && v * GB < used;
  const unchanged = valid && v === currentGb;

  const picks = [...new Set((currentGb ? [currentGb, currentGb + 50, currentGb + 100] : [50, 100, 200]).filter((p) => p <= limitGb))];

  const save = async (gb: number | null) => {
    setBusy(true); setError(null);
    try {
      await setFamilyReservation(member.id, gb);
      onSaved();
    } catch (e) {
      const body = apiErrorBody(e);
      if (body?.code === 'reservation_too_large' && typeof body.max_gb === 'number') {
        setServerMaxGb(body.max_gb);
        setConfirmRemove(false);
      } else {
        setError(apiErrorMessage(e, t('common.error.somethingWentWrong')));
      }
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) onClose(); };

  if (confirmRemove && currentGb) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('common.heading.areYouSure')}</DialogTitle>
            <DialogDescription>
              {richText(t('family.description.youAreEndingNameSSizeReservation', { name: '{name}', size: '{size}' }), {
                name: <strong className="text-foreground">{name}</strong>,
                size: <strong className="text-foreground">{size(currentGb)}</strong>,
              })}
            </DialogDescription>
          </DialogHeader>
          {error && <p dir="auto" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)} disabled={busy}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => void save(null)} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t('family.action.removeReservation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  let note: ReactNode = null;
  if (over) {
    note = <Note tone="error">{t('family.error.onlyMaxIsFreeToReserveForName', { max: size(limitGb), name })}</Note>;
  } else if (below) {
    note = <Note tone="warn">{t('family.description.nameAlreadyUsesUsedWithSizeTheirUploadsStop', { name, used: formatGigabytes(used), size: size(v) })}</Note>;
  } else if (currentGb === null) {
    note = <Note tone="info">{t('family.description.nameUsesUsedNowYouCanReserveUpToMax', { name, used: formatGigabytes(used), max: size(limitGb) })}</Note>;
  }

  const setGb = (gb: number) => { setRaw(String(Math.max(1, gb))); setError(null); };
  const shown = valid ? v : currentGb ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="gap-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold leading-tight">
            {currentGb ? t('family.heading.changeNameSReservation', { name }) : t('family.heading.reserveStorageForName', { name })}
          </DialogTitle>
          <DialogDescription>
            {currentGb
              ? richText(t('family.description.nameHasReservedReservedAndUsesUsed', { name, reserved: '{reserved}', used: '{used}' }), {
                reserved: <strong className="text-foreground">{size(currentGb)}</strong>,
                used: <strong className="text-foreground">{formatGigabytes(used)}</strong>,
              })
              : t('family.description.thisSpaceIsHeldForNameAndIsAlsoTheirLimit', { name })}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex items-center gap-2">
          <Button type="button" variant="secondary" className="h-12 w-11 rounded-xl" aria-label={t('family.accessibility.less')}
            disabled={busy || !valid || v <= 1} onClick={() => setGb((valid ? v : 1) - STEP_GB)}>
            <Minus className="size-4" />
          </Button>
          <div className="relative flex-1">
            <Input
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('family.accessibility.reservationInGb')}
              aria-invalid={over || (!valid && raw !== '') || undefined}
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setError(null); }}
              disabled={busy}
              className="h-12 rounded-xl ps-4 pe-12 text-2xl! font-semibold tabular-nums"
            />
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-4 flex items-center text-sm font-medium text-muted-foreground">{sizeUnits().GB}</span>
          </div>
          <Button type="button" variant="secondary" className="h-12 w-11 rounded-xl" aria-label={t('family.accessibility.more')}
            disabled={busy || limitGb < 1 || (valid && v >= limitGb)} onClick={() => setGb(Math.min((valid ? v : 0) + STEP_GB, limitGb))}>
            <Plus className="size-4" />
          </Button>
        </div>

        {(picks.length > 0 || limitGb >= 1) && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {picks.map((p) => <Pick key={p} on={v === p} onClick={() => setGb(p)}>{String(p)}</Pick>)}
            {limitGb >= 1 && !picks.includes(limitGb) && (
              <Pick on={v === limitGb} onClick={() => setGb(limitGb)}>{t('family.action.maxGb', { gb: limitGb })}</Pick>
            )}
          </div>
        )}

        <PoolPreview people={people} personKey={personKey} name={name} gb={shown} limitGb={limitGb} over={over} poolLimit={poolLimit} />

        {note}
        {error && <p dir="auto" className="mt-3 text-sm text-destructive">{error}</p>}

        <DialogFooter className="mt-5 sm:items-center">
          {currentGb !== null && (
            <Button variant="ghost" className="border-0 text-destructive hover:text-destructive sm:me-auto" disabled={busy} onClick={() => { setError(null); setConfirmRemove(true); }}>
              {t('family.action.removeReservation')}
            </Button>
          )}
          <Button variant="outline" onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={() => void save(v)} disabled={busy || !valid || over || unchanged}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {currentGb ? t('family.action.saveSize', { size: valid ? size(v) : '' }) : t('family.action.reserveSize', { size: valid ? size(v) : '' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pick({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full px-3 text-sm font-semibold tabular-nums transition-colors',
        on ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/70',
      )}
    >
      {children}
    </button>
  );
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <p
      dir="auto"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'mt-3.5 rounded-lg px-3 py-2.5 text-sm leading-snug',
        tone === 'info' && 'bg-muted text-muted-foreground',
        tone === 'warn' && 'bg-(--tone-warn-bg) text-(--tone-warn-ink)',
        tone === 'error' && 'bg-destructive/10 text-destructive',
      )}
    >
      {children}
    </p>
  );
}

/**
 * The pool after this change: everyone else's share (a reservation counts in
 * full, or what they use when that is more), then this person's amount, then
 * what is left. The amount turns red when it does not fit.
 */
function PoolPreview({ people, personKey, name, gb, limitGb, over, poolLimit }: {
  people: ReservationPerson[]; personKey: string; name: string; gb: number; limitGb: number; over: boolean; poolLimit: number;
}) {
  const t = useT();
  const limit = Math.max(poolLimit, 1);
  const me = people.find((p) => p.key === personKey);
  const others = people.filter((p) => p.key !== personKey);
  const pct = (bytes: number) => `${Math.min(100, (Math.max(0, bytes) / limit) * 100)}%`;
  const reservedOther = others.find((p) => p.reserved);
  const sharingOther = others.find((p) => !p.reserved && p.used > 0);
  const mine = me?.color ?? 'var(--foreground)';
  const legend: { key: string; color: string; label: string }[] = [
    { key: 'me', color: over ? 'var(--destructive)' : mine, label: t('family.label.nameSize', { name, size: size(gb) }) },
    ...(reservedOther ? [{ key: 'res', color: tint(reservedOther.color, 45), label: t('family.label.otherReservations') }] : []),
    ...(sharingOther ? [{ key: 'share', color: sharingOther.color, label: t('family.label.usedByPeopleWhoShare') }] : []),
    { key: 'free', color: 'var(--muted)', label: t('family.label.stillFreeSize', { size: size(Math.max(0, limitGb - gb)) }) },
  ];
  return (
    <div className="mt-4">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {others.map((p) => {
          const bytes = p.reserved ? Math.max(p.reserved, p.used) : p.used;
          return bytes > 0 ? <span key={p.key} className="h-full" style={{ width: pct(bytes), background: p.reserved ? tint(p.color, 45) : p.color }} /> : null;
        })}
        {gb > 0 && <span className="h-full" style={{ width: pct(Math.min(gb, limitGb) * GB), background: over ? 'var(--destructive)' : mine }} />}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {legend.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', l.key === 'free' && 'ring-1 ring-border')} style={{ background: l.color }} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

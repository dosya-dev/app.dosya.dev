import { formatDate } from '@/lib/format-locale';
import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { Users, UserMinus, Mail, Loader2, HardDrive, Plus, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import { formatBytes, formatGigabytes, gigabyteFigure } from '@/lib/billing/cart-math';
import {
  getFamily, inviteFamilyMember, revokeFamilyInvite, removeFamilyMember, leaveFamily,
  type FamilyView, type FamilyMemberView,
} from '@/api/family';
import type { BillingStatus } from '@/api/billing';
import { FamilyPlacesDialog } from './family-places-dialog';
import { FamilyReservationDialog, type ReservationPerson } from './family-reservation-dialog';
import { FamilyUsageRing } from './family-usage-ring';
import { isDarkTheme, personColor, personInk, tint, type PoolSegment } from './family-colors';
import { useT } from '@/lib/i18n';
import { subscribeThemeChange } from '@/lib/theme';
import { richText } from '@/lib/rich-text';
import type { MessageKey } from '@/i18n/keys';

/** Card content width (px) from which Members and Usage sit side by side instead of behind the toggle. */
const WIDE_PX = 720;

/** Whether `el` is at least `min` px wide, following resizes. False until measured (and where ResizeObserver is missing). */
function useWiderThan(el: HTMLElement | null, min: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      setWide(w >= min);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min]);
  return wide;
}

/** One person in the pool: payer or active member, with one colour everywhere (avatar, bar, ring, legend). */
type Person = {
  key: string; name: string; isYou: boolean; isPayer: boolean; colorIndex: number;
  used: number; usedLabel: string; reserved: number | null;
};

/**
 * Everyone in the pool, ranked as the Usage list ranks them (payer first, then
 * by usage), and the colour of each active member row. A member row is matched
 * to its usage row by `user_id`; an older API without it falls back to the
 * name (each usage row used once). An unmatched row takes the next free colour.
 */
function buildPeople(data: FamilyView): { people: Person[]; colorOf: Map<string, number>; personKeyOf: Map<string, string> } {
  const people: Person[] = (data.usage ?? []).map((u, i) => ({
    key: u.id, name: u.name, isYou: u.is_you, isPayer: u.is_payer, colorIndex: i,
    used: u.used_bytes, usedLabel: u.used_label, reserved: u.reserved_bytes ?? null,
  }));
  const colorOf = new Map<string, number>();
  const personKeyOf = new Map<string, string>();
  const taken = new Set<string>();
  for (const m of data.members ?? []) {
    if (m.status !== 'active') continue;
    const match = m.user_id !== undefined
      ? people.find((p) => !p.isPayer && m.user_id !== null && p.key === m.user_id)
      : people.find((p) => !p.isPayer && !taken.has(p.key) && p.name === m.name);
    if (match) {
      taken.add(match.key);
      colorOf.set(m.id, match.colorIndex);
      personKeyOf.set(m.id, match.key);
    } else {
      const extra: Person = {
        key: `member:${m.id}`, name: m.name ?? m.email, isYou: false, isPayer: false, colorIndex: people.length,
        used: m.used_bytes ?? 0, usedLabel: formatBytes(m.used_bytes ?? 0), reserved: m.reserved_bytes ?? null,
      };
      people.push(extra);
      colorOf.set(m.id, extra.colorIndex);
      personKeyOf.set(m.id, extra.key);
    }
  }
  return { people, colorOf, personKeyOf };
}

/** Used storage and reserved-but-unused space, per person, as shares of the pool. */
function poolSegments(people: Person[], dark: boolean, heldTint: number): PoolSegment[] {
  return people.flatMap((p) => {
    const color = personColor(p.colorIndex, dark);
    const held = p.reserved ? Math.max(0, p.reserved - p.used) : 0;
    return [
      { key: `${p.key}:used`, bytes: p.used, color },
      ...(held > 0 ? [{ key: `${p.key}:held`, bytes: held, color: tint(color, heldTint) }] : []),
    ];
  });
}

/**
 * The Family section of /billing. Three shapes:
 *  - payer (or an eligible paid user with nobody yet): members, pending
 *    invites, storage reservations, an invite form and the "N of 5" counter;
 *  - member: who pays, their own reservation if any, the pool, and Leave with
 *    its 5 GB warning;
 *  - free user: a one-line pitch, nothing to do until they subscribe.
 * With room (a wide card) Members and Usage sit side by side; otherwise a
 * toggle switches between them. `onChanged` lets the page refresh its own
 * billing status after a change.
 */
export function FamilyCard({ onChanged, billing }: { onChanged?: () => void; billing?: BillingStatus | null }) {
  const t = useT();
  const [data, setData] = useState<FamilyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; kind: MemberAction } | null>(null);
  const [tab, setTab] = useState<'members' | 'usage'>('members');
  const [placesOpen, setPlacesOpen] = useState(false);
  // The reservation dialog keeps the member as it was when opened, so a save's
  // reload cannot change its title while it animates out; seq gives each
  // opening fresh state.
  const [reserve, setReserve] = useState<{ member: FamilyMemberView; seq: number } | null>(null);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const wide = useWiderThan(cardEl, WIDE_PX);
  // Re-render on a theme switch (profile menu, or the OS scheme on "system")
  // so the person colours follow it without a reload.
  const dark = useSyncExternalStore(subscribeThemeChange, isDarkTheme);

  const load = () => getFamily().then((d) => { setData(d); setError(null); }).catch((e) => setError(apiErrorMessage(e, t('billing.error.couldNotLoadFamilyPlan'))));
  useEffect(() => { void load(); }, []);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); onChanged?.(); }
    catch (e) { setError(apiErrorMessage(e, t('common.error.somethingWentWrong'))); }
    finally { setBusy(null); }
  };

  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    void run('invite', async () => { await inviteFamilyMember(addr); setEmail(''); });
  };

  if (!data) {
    return <Card ref={setCardEl} className="p-5 sm:p-6"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4" /> {t('billing.description.familyPlanHaserror', { hasError: error ? 'true' : 'false', error: error ?? '' })}</div></Card>;
  }

  const { people, colorOf, personKeyOf } = buildPeople(data);
  const isMember = data.role === 'member';
  const canBuy = data.can_buy_places === true && !!billing && billing.items.some((i) => i.kind === 'plan');
  // A user with no family has no shared pool to report.
  const inFamily = data.role !== 'none' || (data.members ?? []).length > 0;
  const reservedTotal = data.pool.reserved_bytes ?? 0;
  const reservedCount = people.filter((p) => p.reserved).length;

  const chip = (text: string, green = false) => (
    <span data-slot="family-chip" className={cn(
      'inline-flex h-7 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-semibold',
      green ? 'bg-(--tone-yes-bg) text-(--tone-yes-ink)' : 'bg-muted text-foreground',
    )}>{text}</span>
  );
  const showChips = inFamily || data.eligible;
  const header = (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="me-auto flex items-center gap-2.5 text-lg font-semibold tracking-tight"><Users className="size-5" /> {t('family.heading.familyPlan')}</h2>
        {showChips && chip(t('family.label.planChip', { planName: data.plan.name, limitLabel: data.pool.limit_label }))}
        {isMember
          ? chip(t('billing.status.sharedWithYou'), true)
          : showChips && data.included !== undefined && chip(t('family.label.placesIncludedChip', { count: data.included }), true)}
        {canBuy && !isMember && (data.eligible || (data.members ?? []).length > 0) && <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" onClick={() => setPlacesOpen(true)}>{t('billing.action.purchaseMoreFamilySpots')}</Button>}
      </div>
      {inFamily && (
        <p className="mt-2 text-sm text-muted-foreground">
          {reservedTotal > 0
            ? t('family.description.usedOfLimitReservedForPeople', { usedLabel: data.pool.used_label, limitLabel: data.pool.limit_label, reservedLabel: formatGigabytes(reservedTotal), count: reservedCount })
            : t('family.description.usedlabelOfLimitLabelUsedAcrossTheFamily', { usedLabel: data.pool.used_label, limitLabel: data.pool.limit_label })}
        </p>
      )}
      {inFamily && people.length > 0 && <PoolBar segments={poolSegments(people, dark, 30)} limitBytes={data.pool.limit_bytes} />}
      {!isMember && data.reservations_exceed_pool && (
        <p dir="auto" role="status" className="mt-3 flex items-start gap-2 rounded-lg bg-(--tone-warn-bg) px-3 py-2.5 text-sm text-(--tone-warn-ink)">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('family.error.reservationsAddUpToMoreThanYourPlan')}
        </p>
      )}
    </div>
  );

  // The Usage view needs the per-person list, which older APIs omit; without
  // it the card shows members only.
  const hasUsage = inFamily && Array.isArray(data.usage);
  const columns = hasUsage && wide;
  const usageView = hasUsage ? <FamilyUsage data={data} people={people} dark={dark} /> : null;

  const layout = (membersView: ReactNode) => {
    if (columns) {
      return (
        <div data-slot="family-columns" className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-8">
          <section className="min-w-0">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t('common.label.members')}</h3>
            {membersView}
          </section>
          <section className="min-w-0">
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{t('billing.label.usage')}</h3>
            {usageView}
          </section>
        </div>
      );
    }
    if (hasUsage) {
      return (
        <>
          <PillToggle value={tab} onChange={setTab} label={t('billing.accessibility.familyPlan')}
            options={[['members', t('common.label.members')], ['usage', t('billing.label.usage')]]} />
          {tab === 'usage' ? usageView : membersView}
        </>
      );
    }
    return membersView;
  };

  const avatar = (name: string, colorIndex: number | null) => (
    <span
      data-slot="avatar"
      aria-hidden="true"
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-full text-base font-semibold',
        colorIndex === null && 'border-2 border-dashed border-muted-foreground/50 text-muted-foreground',
      )}
      style={colorIndex === null ? undefined : { background: personColor(colorIndex, dark), color: personInk(colorIndex, dark) }}
    >
      {([...name.trim()][0] ?? '?').toLocaleUpperCase()}
    </span>
  );
  const pill = (text: string, colorIndex: number | null) => (
    <span
      className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full bg-muted px-2.5 text-xs font-semibold text-muted-foreground"
      style={colorIndex === null ? undefined : { background: tint(personColor(colorIndex, dark), 16), color: personColor(colorIndex, dark) }}
    >{text}</span>
  );
  /** "184 of 200 GB reserved" or "72 GB · shares the pool". */
  const usageLine = (used: number, reserved: number | null) => reserved
    ? <span className="font-medium text-foreground">{t('family.label.usedOfReservedReserved', { used: gigabyteFigure(used), reserved: formatGigabytes(reserved) })}</span>
    : t('family.label.usedSharesThePool', { used: formatGigabytes(used) });
  const personRow = (key: string, name: string, colorIndex: number | null, sub: ReactNode, end: ReactNode, title?: string) => (
    <li key={key} className="flex items-center gap-3 py-2.5">
      {avatar(name, colorIndex)}
      <div className="min-w-0 flex-1" title={title}>
        <p data-slot="person-name" className="truncate text-sm font-semibold">{name}</p>
        <p className="line-clamp-2 break-words text-xs text-muted-foreground">{sub}</p>
      </div>
      {end}
    </li>
  );
  const displayName = (p: Person) => p.isYou ? t('family.label.nameYou', { name: p.name }) : p.name;

  if (isMember) {
    const me = people.find((p) => p.isYou);
    const ownReserved = data.own_reserved_bytes ?? null;
    const ownUsed = data.own_used_bytes ?? me?.used ?? 0;
    const membersView = (
      <div className="space-y-4">
        {ownReserved !== null && ownReserved > 0 && (
          <div className="rounded-xl bg-muted/60 p-4">
            <p className="text-sm text-muted-foreground">{t('family.label.reservedForYouByPayerName', { payerName: data.payer?.name ?? '' })}</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight">{t('family.label.usedOfReserved', { used: gigabyteFigure(ownUsed), reserved: formatGigabytes(ownReserved) })}</p>
            <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (ownUsed / ownReserved) * 100)}%`, background: personColor(me?.colorIndex ?? 0, dark) }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('family.description.thisSpaceIsYoursAloneUploadsStopAtSize', { size: formatGigabytes(ownReserved) })}</p>
          </div>
        )}
        <p className="text-sm">
          {richText(t('family.description.youAreOnPayerNameSPlanNamePlanYourFiles', { payerName: '{payerName}', planName: data.plan.name }), { payerName: <strong>{data.payer?.name}</strong> })}
        </p>
        {people.length > 0 && (
          <ul className="divide-y">
            {people.map((p) => personRow(p.key, displayName(p), p.colorIndex, usageLine(p.used, p.reserved),
              p.isPayer ? pill(t('family.status.paysThePlan'), null) : pill(t('family.status.joined'), p.colorIndex)))}
          </ul>
        )}
        {!confirmLeave ? (
          <div className="space-y-2">
            <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={() => setConfirmLeave(true)}>{t('family.action.leaveFamilyPlan')}</Button>
            <p className="text-xs text-muted-foreground">{t('family.description.ifYouLeaveYourAccountReturnsToTheFree')}</p>
          </div>
        ) : (
          <div className="rounded-lg border p-3 text-sm space-y-3">
            <p>
              {t('billing.description.leavingPutsYourAccountBackOnTheFreePlanWith5')}
            </p>
            {data.own_used_label && (
              <p className="font-medium">{t('billing.description.youCurrentlyStoreDataownUsedLabelTheFreePlanHolds5Gb', { dataOwn_used_label: data.own_used_label })}</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy === 'leave'} onClick={() => void run('leave', leaveFamily)}>
                {busy === 'leave' ? <Loader2 className="size-4 animate-spin" /> : t('common.action.leave')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>{t('billing.action.keepSharing')}</Button>
            </div>
          </div>
        )}
      </div>
    );
    return (
      <Card ref={setCardEl} id="family-plan" className="gap-5 p-5 sm:p-6">
        {header}
        {layout(membersView)}
        {error && <p dir="auto" className="text-sm text-destructive">{error}</p>}
      </Card>
    );
  }

  if (!data.eligible && (data.members ?? []).length === 0) {
    return (
      <Card ref={setCardEl} id="family-plan" className="gap-2 p-5 sm:p-6">
        {header}
        <p className="text-sm text-muted-foreground">
          {t('billing.description.anyPaidPlanCanBeSharedWithUpToDatalimitFamily', { dataLimit: data.limit })}
        </p>
      </Card>
    );
  }

  const members = data.members ?? [];
  const slotsUsed = members.length;
  const full = slotsUsed >= data.limit;
  const overCapacity = data.over_capacity === true;
  const included = data.included ?? data.limit;
  const extra = data.extra_places ?? 0;
  const payer = people.find((p) => p.isPayer);

  const openReserve = (m: FamilyMemberView) => {
    setReserve((r) => ({ member: m, seq: (r?.seq ?? 0) + 1 }));
    setReserveOpen(true);
  };
  const reservationPeople: ReservationPerson[] = people.map((p) => ({
    key: p.key, name: p.name, color: personColor(p.colorIndex, dark), used: p.used, reserved: p.reserved,
  }));

  const memberRow = (m: FamilyMemberView) => {
    const invited = m.status === 'invited';
    const colorIndex = invited ? null : colorOf.get(m.id) ?? null;
    const name = m.name ?? m.email;
    const sub = invited
      ? t('billing.description.invitedExpiresMexpiresAtSelectTrueFormatteddateOtherSoon', { mExpires_at: String(!!m.expires_at), formattedDate: m.expires_at ? formatDate(m.expires_at, 'short') : '' })
      : m.used_bytes !== undefined ? usageLine(m.used_bytes, m.reserved_bytes ?? null) : m.email;
    const canReserve = data.eligible && !invited && m.max_reservable_bytes !== undefined;
    const reservedBytes = m.reserved_bytes ?? null;
    const end = (
      <div className="flex shrink-0 items-center gap-1">
        {canReserve ? (
          <button
            type="button"
            onClick={() => openReserve(m)}
            title={reservedBytes ? t('family.heading.changeNameSReservation', { name }) : t('family.heading.reserveStorageForName', { name })}
            className={cn(
              'me-1 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-2.5 text-xs font-semibold transition-colors hover:bg-muted',
              reservedBytes ? 'border-border text-foreground' : 'border-dashed border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {reservedBytes ? <HardDrive className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
            {reservedBytes ? formatGigabytes(reservedBytes) : t('family.action.reserve')}
          </button>
        ) : (
          <span className="me-1">{invited ? pill(t('common.status.invited'), null) : pill(t('family.status.joined'), colorIndex)}</span>
        )}
        {invited && (
          <Button size="icon-sm" variant="ghost" className="border-0 text-muted-foreground" disabled={busy === `resend:${m.id}`} onClick={() => setConfirm({ id: m.id, kind: 'resend' })} title={t('billing.action.sendTheInvitationAgain')}>
            <Mail className="size-4" />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" className="border-0 text-muted-foreground" disabled={busy === `rm:${m.id}`} title={!invited ? t('billing.action.removeFromFamily') : t('billing.action.revokeInvitation')}
          onClick={() => setConfirm({ id: m.id, kind: !invited ? 'remove' : 'revoke' })}>
          <UserMinus className="size-4" />
        </Button>
      </div>
    );
    return personRow(m.id, name, colorIndex, sub, end, m.email);
  };

  const membersView = (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t('family.description.membercountOfLimitPlacesUsedPlacesMembersKeepTheir', { memberCount: slotsUsed, limit: data.limit, places: data.included !== undefined ? ` ${t('billing.label.includedIncludedExtraExtra', { included, extra })}` : '' })}
      </p>
      {overCapacity && (
        <p className="text-xs text-muted-foreground">
          {t('billing.description.youHaveMorePeopleThanPlacesNobodyHasBeenRemovedNew', { canBuyOrYou: canBuy ? ` ${t('billing.description.orYouAddPlaces')}` : '' })}
        </p>
      )}
      {(payer || members.length > 0) && (
        <ul className="divide-y">
          {payer && personRow(payer.key, displayName(payer), payer.colorIndex, usageLine(payer.used, null), pill(t('family.status.paysThePlan'), null))}
          {members.map(memberRow)}
        </ul>
      )}
      {data.eligible ? (
        <form onSubmit={onInvite} className="flex gap-2 pt-1">
          <Input type="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('family.placeholder.familyExampleCom')} disabled={full || overCapacity || busy === 'invite'} required />
          <Button type="submit" className="h-10 px-4" disabled={full || overCapacity || busy === 'invite'}>{busy === 'invite' ? <Loader2 className="size-4 animate-spin" /> : t('common.action.invite')}</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('billing.error.yourPaidPlanHasEndedSoYouCannotInviteAnyoneNew')}
        </p>
      )}
      {data.eligible && full && !overCapacity && <p className="text-xs text-muted-foreground">{t('family.description.allLimitPlacesAreTakenRemoveSomeoneOrRevoke', { limit: data.limit })}</p>}
    </div>
  );

  return (
    <Card ref={setCardEl} id="family-plan" className="gap-5 p-5 sm:p-6">
      {header}
      {layout(membersView)}
      {canBuy && billing && (
        <FamilyPlacesDialog open={placesOpen} onClose={() => setPlacesOpen(false)} billing={billing} current={extra} included={included} max={10} />
      )}
      <MemberActionDialog
        member={members.find((m) => m.id === confirm?.id) ?? null}
        kind={confirm?.kind ?? null}
        busy={busy === `rm:${confirm?.id}` || busy === `resend:${confirm?.id}`}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const target = members.find((m) => m.id === confirm?.id);
          const kind = confirm?.kind;
          if (!target || !kind) return;
          if (kind === 'resend') {
            void run(`resend:${target.id}`, async () => { await inviteFamilyMember(target.email); setConfirm(null); });
            return;
          }
          void run(`rm:${target.id}`, async () => {
            await (kind === 'remove' ? removeFamilyMember(target.id) : revokeFamilyInvite(target.id));
            setConfirm(null);
          });
        }}
      />
      {reserve && (
        <FamilyReservationDialog
          key={`${reserve.member.id}:${reserve.seq}`}
          open={reserveOpen}
          member={reserve.member}
          personKey={personKeyOf.get(reserve.member.id) ?? ''}
          people={reservationPeople}
          poolLimit={data.pool.limit_bytes}
          onClose={() => setReserveOpen(false)}
          onSaved={() => { setReserveOpen(false); void load(); onChanged?.(); }}
        />
      )}
      {error && <p dir="auto" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

/** The pool as one stacked bar under the header: used and held space per person. */
function PoolBar({ segments, limitBytes }: { segments: PoolSegment[]; limitBytes: number }) {
  const limit = Math.max(limitBytes, 1);
  return (
    <div aria-hidden="true" className="mt-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
      {segments.filter((s) => s.bytes > 0).map((s) => (
        <span key={s.key} className="h-full" style={{ width: `${Math.min(100, (s.bytes / limit) * 100)}%`, background: s.color }} />
      ))}
    </div>
  );
}

// rtl-ok: mirrored, the rtl: variant slides the other way
const PILL_SLIDE = 'data-[index=1]:translate-x-full rtl:data-[index=1]:-translate-x-full';

/**
 * Members | Usage as a pill toggle. The highlight slides under the picked
 * option, easing out with no overshoot (and not at all with reduced motion).
 */
function PillToggle<V extends string>({ value, onChange, options, label }: {
  value: V; onChange: (v: V) => void; options: [V, string][]; label: string;
}) {
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div role="tablist" aria-label={label} className="relative grid h-11 grid-cols-2 rounded-full bg-muted p-1">
      <span
        aria-hidden="true"
        data-index={index}
        className={cn('absolute inset-y-1 start-1 w-[calc(50%-4px)] rounded-full bg-background shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:bg-foreground/15', PILL_SLIDE)}
      />
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={v === value}
          onClick={() => onChange(v)}
          className={cn('relative rounded-full text-sm font-semibold transition-colors', v === value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * The Usage view: a ring for the pool with one arc per person (and a faded arc
 * for reserved space they have not used), and the same people as a ranked list
 * with bars. Both are shares of the WHOLE pool. Totals only, and the people are
 * what /api/family already lists; nothing about files.
 */
function FamilyUsage({ data, people, dark }: { data: FamilyView; people: Person[]; dark: boolean }) {
  const t = useT();
  const limit = Math.max(data.pool.limit_bytes, 1);
  const reservedTotal = data.pool.reserved_bytes ?? 0;
  const held = data.pool.held_bytes ?? 0;
  const free = data.pool.free_bytes ?? Math.max(0, limit - data.pool.used_bytes);
  const width = (bytes: number) => `${Math.min(100, (Math.max(0, bytes) / limit) * 100)}%`;
  const firstReserved = people.find((p) => p.reserved);
  return (
    <div className="flex flex-col gap-5">
      <FamilyUsageRing
        segments={poolSegments(people, dark, 32)}
        limitBytes={data.pool.limit_bytes}
        usedBytes={data.pool.used_bytes}
        usedLabel={data.pool.used_label}
        limitLabel={data.pool.limit_label}
        reservedLabel={reservedTotal > 0 ? formatGigabytes(reservedTotal) : null}
      />
      <ul data-slot="family-legend" className="flex min-w-0 flex-col gap-3" aria-label={t('family.accessibility.storageUsedByEachPerson')}>
        {people.map((p) => {
          const color = personColor(p.colorIndex, dark);
          const heldBytes = p.reserved ? Math.max(0, p.reserved - p.used) : 0;
          return (
            <li key={p.key} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: color }} />
                  <span className="truncate">{p.isYou ? t('common.label.you') : p.name}</span>
                  {p.isPayer && <span className="shrink-0 text-xs text-muted-foreground">{t('family.label.paysThePlan')}</span>}
                  {p.reserved ? <span className="shrink-0 text-xs text-muted-foreground">{t('family.label.reservedTag')}</span> : null}
                </span>
                <span className="shrink-0 font-mono text-[13px]">
                  {p.reserved ? t('family.label.usedOfReserved', { used: gigabyteFigure(p.used), reserved: formatGigabytes(p.reserved) }) : p.usedLabel}
                </span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                <span className="h-full" style={{ width: width(p.used), background: color }} />
                {heldBytes > 0 && <span className="h-full" style={{ width: width(heldBytes), background: tint(color, 32) }} />}
              </div>
            </li>
          );
        })}
        {reservedTotal > 0 ? (
          <>
            <li className="flex items-center justify-between gap-3 border-t pt-2.5 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-muted ring-1 ring-border" />{t('family.label.freeToShare')}</span>
              <span className="font-mono">{formatBytes(free)}</span>
            </li>
            <li className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: tint(personColor(firstReserved?.colorIndex ?? 1, dark), 32) }} />
                {t('family.label.heldForReservations')}
              </span>
              <span className="font-mono">{formatBytes(held)}</span>
            </li>
          </>
        ) : (
          <li className="flex items-center justify-between gap-3 border-t pt-2.5 text-[13px] text-muted-foreground">
            <span>{t('family.label.freeInThePool')}</span>
            <span className="font-mono">{formatBytes(free)}</span>
          </li>
        )}
      </ul>
    </div>
  );
}

type MemberAction = 'remove' | 'revoke' | 'resend';

// Keys, translated at render.
const ACTION_COPY: Record<MemberAction, { verb: MessageKey; busy: MessageKey; keep: MessageKey; destructive: boolean }> = {
  remove: { verb: 'common.remove', busy: 'billing.status.removing', keep: 'family.action.keep', destructive: true },
  revoke: { verb: 'common.action.revoke', busy: 'billing.status.revoking', keep: 'family.action.keep', destructive: true },
  resend: { verb: 'family.action.sendAgain', busy: 'billing.status.sending', keep: 'common.cancel', destructive: false },
};

/**
 * Every action on a row asks first, in a modal, the way cancelling the
 * subscription does. Removing puts someone back on the free plan; revoking
 * kills their link; resending issues a fresh link and kills the old one, and
 * the API only allows it once a minute, so a stray click should not spend it.
 */
function MemberActionDialog({ member, kind, busy, onClose, onConfirm }: {
  member: FamilyMemberView | null;
  kind: MemberAction | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // The row and action are cleared by the parent the instant a button is
  // pressed, but the dialog is still on screen while it animates out.
  // Rendering from the cleared values swapped the wording mid-fade, so the
  // last pair is kept until the dialog is gone.
  const [shown, setShown] = useState<{ member: FamilyMemberView; kind: MemberAction } | null>(member && kind ? { member, kind } : null);
  useEffect(() => { if (member && kind) setShown({ member, kind }); }, [member, kind]);
  const m = member && kind ? member : shown?.member ?? null;
  const k = member && kind ? kind : shown?.kind ?? 'remove';
  const t = useT();
  const copy = ACTION_COPY[k];

  return (
    <Dialog open={member !== null && kind !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          {k === 'resend' && (
            <>
              <DialogTitle>{t('billing.heading.sendTheInvitationToMemailAgain', { email: m?.email ?? '' })}</DialogTitle>
              <DialogDescription>
                {t('family.description.theyGetAFreshEmailWithANewLink')}
              </DialogDescription>
            </>
          )}
          {k === 'revoke' && (
            <>
              <DialogTitle>{t('billing.heading.revokeTheInvitationToMemail', { email: m?.email ?? '' })}</DialogTitle>
              <DialogDescription>
                {t('family.label.theLinkInTheirEmailStopsWorkingYouCan')}
              </DialogDescription>
            </>
          )}
          {k === 'remove' && (
            <>
              <DialogTitle>{t('billing.heading.removeMnamemFromYourFamilyPlan', { who: m?.name ?? m?.email ?? '' })}</DialogTitle>
              <DialogDescription>
                {t('billing.description.theirAccountReturnsToTheFreePlanWith5GbNothing', { mOver_freeThey: m?.over_free ? t('billing.description.theyCurrentlyStoreMoreThan5GBSo') : '' }).trimEnd()}
              </DialogDescription>
            </>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t(copy.keep)}</Button>
          <Button variant={copy.destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? t(copy.busy) : t(copy.verb)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

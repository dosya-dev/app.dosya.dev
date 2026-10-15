// apps/web/src/components/billing/family-card.tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Users, UserMinus, Mail, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/billing/cart-math';
import { SWATCHES } from '@/lib/palette';
import {
  getFamily, inviteFamilyMember, revokeFamilyInvite, removeFamilyMember, leaveFamily,
  type FamilyView, type FamilyMemberView, type FamilyUsageRow,
} from '@/api/family';
import type { BillingStatus } from '@/api/billing';
import { FamilyPlacesDialog } from './family-places-dialog';

/**
 * The Family section of /billing. Three shapes:
 *  - payer (or an eligible paid user with nobody yet): members, pending
 *    invites, an invite form and the "N of 5" counter;
 *  - member: who pays, the shared pool, and Leave with its 5 GB warning;
 *  - free user: a one-line pitch, nothing to do until they subscribe.
 * `onChanged` lets the page refresh its own billing status after a change.
 */
export function FamilyCard({ onChanged, billing }: { onChanged?: () => void; billing?: BillingStatus | null }) {
  const [data, setData] = useState<FamilyView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; kind: MemberAction } | null>(null);
  const [tab, setTab] = useState<'members' | 'usage'>('members');
  const [placesOpen, setPlacesOpen] = useState(false);

  const load = () => getFamily().then((d) => { setData(d); setError(null); }).catch((e) => setError(apiErrorMessage(e, 'Could not load family plan')));
  useEffect(() => { void load(); }, []);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); onChanged?.(); }
    catch (e) { setError(apiErrorMessage(e, 'Something went wrong')); }
    finally { setBusy(null); }
  };

  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    void run('invite', async () => { await inviteFamilyMember(addr); setEmail(''); });
  };

  if (!data) {
    return <Card className="p-5 sm:p-6"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Users className="size-4" /> Family plan{error ? ` · ${error}` : ''}</div></Card>;
  }

  // A user with no family has no shared pool to report.
  const canBuy = data.can_buy_places === true && !!billing && billing.items.some((i) => i.kind === 'plan');
  const inFamily = data.role !== 'none' || (data.members ?? []).length > 0;
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold flex items-center gap-2"><Users className="size-4" /> Family plan</h2>
        {inFamily && (
          <p className="text-sm text-muted-foreground mt-1">
            {data.pool.used_label} of {data.pool.limit_label} used across the family.
          </p>
        )}
      </div>
      {data.role === 'member' && <Badge>Shared with you</Badge>}
      {canBuy && data.role !== 'member' && (data.eligible || (data.members ?? []).length > 0) && <Button size="sm" variant="outline" className="shrink-0 whitespace-nowrap" onClick={() => setPlacesOpen(true)}>Purchase more family spots</Button>}
    </div>
  );
  // The Usage tab needs the per-person list, which older APIs omit; without
  // it the card stays single-view.
  const showTabs = inFamily && Array.isArray(data.usage);
  const tabs = showTabs ? (
    <div role="tablist" aria-label="Family plan" className="flex gap-5 border-b">
      {([['members', 'Members'], ['usage', 'Usage']] as const).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => setTab(key)}
          className={cn(
            'pb-2.5 pt-1 text-sm -mb-px border-b-2 transition-colors',
            tab === key ? 'border-foreground font-semibold text-foreground' : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;
  const usageTab = showTabs && tab === 'usage';

  if (data.role === 'member') {
    return (
      <Card className="p-5 sm:p-6 space-y-4">
        {header}
        {tabs}
        {usageTab && <FamilyUsage data={data} />}
        {!usageTab && (<>
        <p className="text-sm">
          You are on <strong>{data.payer?.name}</strong>'s {data.plan.name} plan. Your files stay private; only the storage pool and the bill are shared.
        </p>
        <p className="text-xs text-muted-foreground">If you leave, your account returns to the free plan with 5 GB. Nothing is deleted.</p>
        {!confirmLeave ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmLeave(true)}>Leave family plan</Button>
        ) : (
          <div className="rounded-lg border p-3 text-sm space-y-3">
            <p>
              Leaving puts your account back on the free plan with 5 GB. Nothing is deleted, but if you store more than 5 GB,
              uploads pause until you free space or choose a plan of your own.
            </p>
            {data.own_used_label && (
              <p className="font-medium">You currently store {data.own_used_label}. The free plan holds 5 GB.</p>
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" disabled={busy === 'leave'} onClick={() => void run('leave', leaveFamily)}>
                {busy === 'leave' ? <Loader2 className="size-4 animate-spin" /> : 'Leave'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>Keep sharing</Button>
            </div>
          </div>
        )}
        </>)}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
    );
  }

  if (!data.eligible && (data.members ?? []).length === 0) {
    return (
      <Card className="p-5 sm:p-6 space-y-2">
        {header}
        <p className="text-sm text-muted-foreground">
          Any paid plan can be shared with up to {data.limit} family members. Everyone keeps their own account; you share the storage and the bill.
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

  const row = (m: FamilyMemberView) => (
    <li key={m.id} className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{m.name ?? m.email}</p>
          <p className="text-xs text-muted-foreground truncate">
            {m.status === 'active' ? m.email : `Invited · expires ${m.expires_at ? new Date(m.expires_at * 1000).toLocaleDateString() : 'soon'}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {m.status === 'invited' && (
            <Button size="sm" variant="ghost" disabled={busy === `resend:${m.id}`} onClick={() => setConfirm({ id: m.id, kind: 'resend' })} title="Send the invitation again">
              <Mail className="size-4" />
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy === `rm:${m.id}`} title={m.status === 'active' ? 'Remove from family' : 'Revoke invitation'}
            onClick={() => setConfirm({ id: m.id, kind: m.status === 'active' ? 'remove' : 'revoke' })}>
            <UserMinus className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );

  return (
    <Card className="p-5 sm:p-6 space-y-4">
      {header}
      {tabs}
      {usageTab && <FamilyUsage data={data} />}
      {!usageTab && (<>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {slotsUsed} of {data.limit} places used{data.included !== undefined && ` (${included} included, ${extra} extra)`}. Members keep their own accounts and private files.
        </p>
      </div>
      {overCapacity && (
        <p className="text-xs text-muted-foreground">
          You have more people than places. Nobody has been removed; new invitations wait until someone leaves{canBuy && ' or you add places'}.
        </p>
      )}
      {canBuy && billing && (
        <FamilyPlacesDialog open={placesOpen} onClose={() => setPlacesOpen(false)} billing={billing} current={extra} included={included} max={10} />
      )}
      {members.length > 0 && <ul className="divide-y rounded-lg border px-3">{members.map(row)}</ul>}
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
      {data.eligible ? (
        <form onSubmit={onInvite} className="flex gap-2">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="family@example.com" disabled={full || overCapacity || busy === 'invite'} required />
          <Button type="submit" disabled={full || overCapacity || busy === 'invite'}>{busy === 'invite' ? <Loader2 className="size-4 animate-spin" /> : 'Invite'}</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your paid plan has ended, so you cannot invite anyone new. Remove people or revoke invitations here; subscribe again to share your plan.
        </p>
      )}
      {data.eligible && full && !overCapacity && <p className="text-xs text-muted-foreground">All {data.limit} places are taken. Remove someone or revoke an invitation to free one.</p>}
      </>)}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

type MemberAction = 'remove' | 'revoke' | 'resend';

const ACTION_COPY: Record<MemberAction, { verb: string; busy: string; keep: string; destructive: boolean }> = {
  remove: { verb: 'Remove', busy: 'Removing', keep: 'Keep', destructive: true },
  revoke: { verb: 'Revoke', busy: 'Revoking', keep: 'Keep', destructive: true },
  resend: { verb: 'Send again', busy: 'Sending', keep: 'Cancel', destructive: false },
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
  const copy = ACTION_COPY[k];

  return (
    <Dialog open={member !== null && kind !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          {k === 'resend' && (
            <>
              <DialogTitle>Send the invitation to {m?.email} again?</DialogTitle>
              <DialogDescription>
                They get a fresh email with a new link, and the link in the earlier email stops working. You can resend once a minute.
              </DialogDescription>
            </>
          )}
          {k === 'revoke' && (
            <>
              <DialogTitle>Revoke the invitation to {m?.email}?</DialogTitle>
              <DialogDescription>
                The link in their email stops working. You can invite them again at any time.
              </DialogDescription>
            </>
          )}
          {k === 'remove' && (
            <>
              <DialogTitle>Remove {m?.name ?? m?.email} from your family plan?</DialogTitle>
              <DialogDescription>
                Their account returns to the free plan with 5 GB. Nothing is deleted, and you can invite them again later.
                {m?.over_free && ' They currently store more than 5 GB, so their uploads will pause until they free space or choose a plan.'}
              </DialogDescription>
            </>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{copy.keep}</Button>
          <Button variant={copy.destructive ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? copy.busy : copy.verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Per-person colours come from the brand's identity swatches (the set used for
 * workspace and avatar colours), assigned by rank and never cycled: a family
 * holds at most six people and the set has seven. Light and dark fills are
 * both from the palette; which one applies follows the document theme.
 */
function personColor(index: number, dark: boolean): string {
  const sw = SWATCHES[index % SWATCHES.length];
  return dark ? sw.dark : sw.light;
}
const RING_R = 84;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The Usage tab: a ring for the pool with one arc per person, and the same
 * people as a ranked list with bars. Both are shares of the WHOLE pool, so
 * the arcs and the bars add up to the ring's percentage. Totals only, and
 * the people are what /api/family already lists; nothing about files.
 */
function FamilyUsage({ data }: { data: FamilyView }) {
  const rows = data.usage ?? [];
  const limit = Math.max(data.pool.limit_bytes, 1);
  const used = data.pool.used_bytes;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const freeBytes = Math.max(0, limit - used);
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  let offset = 0;
  const arcs = rows.map((r, i) => {
    const len = (Math.min(r.used_bytes, limit) / limit) * RING_C;
    const arc = { id: r.id, color: personColor(i, dark), len, offset };
    offset += len;
    return arc;
  });
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative mx-auto size-[200px] shrink-0 sm:mx-0">
        <svg role="img" aria-label={`${pct} percent of the family pool used`} width="200" height="200" viewBox="0 0 200 200">
          <circle cx="100" cy="100" r={RING_R} fill="none" className="stroke-muted" strokeWidth="18" />
          {arcs.filter((a) => a.len > 0).map((a) => (
            <circle
              key={a.id}
              cx="100" cy="100" r={RING_R} fill="none" stroke={a.color} strokeWidth="18"
              strokeDasharray={`${Math.max(0, a.len - 2)} ${RING_C}`}
              strokeDashoffset={-a.offset}
              transform="rotate(-90 100 100)"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="font-mono text-[34px] leading-none">{pct}%</span>
          <span className="text-xs text-muted-foreground">{data.pool.used_label} used</span>
        </div>
      </div>
      <ol className="flex min-w-0 flex-1 flex-col gap-3" aria-label="Storage used by each person">
        {rows.map((r, i) => (
          <li key={r.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-[2px]" style={{ background: personColor(i, dark) }} />
                <span className="truncate">{r.is_you ? 'You' : r.name}</span>
                {r.is_payer && <span className="shrink-0 text-muted-foreground">· pays the plan</span>}
              </span>
              <span className="shrink-0 font-mono">{r.used_label}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (r.used_bytes / limit) * 100)}%`, background: personColor(i, dark) }} />
            </div>
          </li>
        ))}
        <li className="flex items-center justify-between border-t pt-2 text-[13px] text-muted-foreground">
          <span>Free in the pool</span>
          <span className="font-mono">{formatBytes(freeBytes)}</span>
        </li>
      </ol>
    </div>
  );
}

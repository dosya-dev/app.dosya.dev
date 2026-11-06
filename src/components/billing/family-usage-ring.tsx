import { useT } from '@/lib/i18n';
import type { PoolSegment } from './family-colors';

const RING_R = 84;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The pool as a ring: one arc per segment, each a share of the WHOLE pool, so
 * the arcs add up to what is used and held. The centre names the used figure
 * against the pool, and the reserved total when there is one.
 */
export function FamilyUsageRing({ segments, limitBytes, usedBytes, usedLabel, limitLabel, reservedLabel }: {
  segments: PoolSegment[];
  limitBytes: number;
  usedBytes: number;
  usedLabel: string;
  limitLabel: string;
  /** The reserved total, or null when nobody has a reservation. */
  reservedLabel: string | null;
}) {
  const t = useT();
  const limit = Math.max(limitBytes, 1);
  const pct = Math.min(100, Math.round((usedBytes / limit) * 100));
  const lens = segments.map((s) => (Math.min(Math.max(s.bytes, 0), limit) / limit) * RING_C);
  const arcs = segments.map((s, i) => ({ key: s.key, color: s.color, len: lens[i], offset: lens.slice(0, i).reduce((a, l) => a + l, 0) }));
  return (
    <div className="relative mx-auto size-[200px] shrink-0">
      <svg role="img" aria-label={t('family.accessibility.pctPercentOfTheFamilyPoolUsed', { pct })} width="200" height="200" viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={RING_R} fill="none" className="stroke-muted" strokeWidth="18" />
        {arcs.filter((a) => a.len > 0).map((a) => (
          <circle
            key={a.key}
            cx="100" cy="100" r={RING_R} fill="none" stroke={a.color} strokeWidth="18"
            strokeDasharray={`${Math.max(0, a.len - 2)} ${RING_C}`}
            strokeDashoffset={-a.offset}
            transform="rotate(-90 100 100)"
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-8 text-center">
        <span className="text-[30px] font-semibold leading-none tracking-tight">{usedLabel}</span>
        <span className="mt-1 text-xs text-muted-foreground">{t('family.label.ofLimitPct', { limitLabel, pct })}</span>
        {reservedLabel && <span className="text-xs text-muted-foreground">{t('family.label.sizeReserved', { size: reservedLabel })}</span>}
      </div>
    </div>
  );
}

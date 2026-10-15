import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * The one seam between a media player and the comments UI. A player registers
 * what "where am I" and "go there" mean for its medium; the comments panel and
 * the markers read it. Players never import comment code, and with no
 * provider above them (every existing test, the share page) registering is a
 * no-op.
 */
export type AnchorTarget =
  | { kind: 'time'; now(): number; seek(ms: number): void; pause(): void }
  | { kind: 'page'; now(): number; goTo(page: number): void };

export interface AnchorMarker { id: string; ms: number | null; page: number | null; dim: boolean; initial: string; excerpt: string }
export type PendingAnchor = { ms: number } | { page: number } | null;

interface Ctx {
  target: AnchorTarget | null;
  register: (t: AnchorTarget | null) => void;
  markers: AnchorMarker[];
  selectComment: (id: string) => void;
}

const NOOP: Ctx = { target: null, register: () => {}, markers: [], selectComment: () => {} };
const AnchorContext = createContext<Ctx>(NOOP);

export function AnchorProvider({ markers, pending, onPendingApplied, onSelectComment, children }: {
  markers: AnchorMarker[];
  pending: PendingAnchor;
  onPendingApplied: () => void;
  onSelectComment: (id: string) => void;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<AnchorTarget | null>(null);

  // A deep link's anchor is applied by whichever player of the right kind
  // registers first, once. A page anchor never seeks audio; a player that
  // fails to decode never registers, so the anchor just stays unapplied.
  useEffect(() => {
    if (!target || !pending) return;
    if ('ms' in pending && target.kind === 'time') { target.seek(pending.ms); onPendingApplied(); }
    else if ('page' in pending && target.kind === 'page') { target.goTo(pending.page); onPendingApplied(); }
  }, [target, pending, onPendingApplied]);

  const value = useMemo<Ctx>(() => ({ target, register: setTarget, markers, selectComment: onSelectComment }),
    [target, markers, onSelectComment]);
  return <AnchorContext.Provider value={value}>{children}</AnchorContext.Provider>;
}

export function useAnchorTarget(): AnchorTarget | null {
  return useContext(AnchorContext).target;
}

export function useRegisterAnchorTarget(target: AnchorTarget | null): void {
  const { register } = useContext(AnchorContext);
  useEffect(() => {
    register(target);
    return () => register(null);
  }, [register, target]);
}

export function useAnchorMarkers(): { markers: AnchorMarker[]; selectComment: (id: string) => void } {
  const { markers, selectComment } = useContext(AnchorContext);
  return { markers, selectComment };
}

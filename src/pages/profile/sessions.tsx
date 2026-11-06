import { useState, useEffect, useCallback } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Monitor, Smartphone, Loader2, LogOut } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import { SectionSkeleton, type Session } from './shared';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await req<{ ok: boolean; sessions: Session[] }>('/api/me/sessions');
    if (res.ok) setSessions(res.sessions);
    else setSessions((s) => s ?? []);
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  if (sessions === null) return <SectionSkeleton />;
  return <SessionsSection sessions={sessions} onChanged={loadSessions} />;
}

// ── Sessions ───────────────────────────────────────────────

export function SessionsSection({ sessions, onChanged }: { sessions: Session[]; onChanged: () => void }) {
  const t = useT();
  const [revoking, setRevoking] = useState(false);

  const revokeAll = async () => {
    setRevoking(true);
    const res = await req('/api/me/sessions', { method: 'DELETE' });
    if (res.ok) { toast.success(t('profile.feedback.sessionsRevoked'), t('profile.feedback.youAreNowSignedOutEverywhereElse')); onChanged(); } else toast.error(t('common.error.revokeFailed'), res.error ?? t('profile.error.theOtherSessionsCouldNotBeRevoked'));
    setRevoking(false);
  };

  return (
    <section id="section-sessions">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.activeSessions')}</h2>
      <Card>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('profile.label.noSessions')}</p>
          ) : (
            <>
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-3 border-b last:border-b-0">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    {s.kind === 'mobile' || s.kind === 'tablet'
                      ? <Smartphone className="size-4 text-muted-foreground" />
                      : <Monitor className="size-4 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{s.device} {s.is_current && <Badge className="ms-1 text-[9px] bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">{t('profile.status.current')}</Badge>}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{s.meta}</p>
                  </div>
                </div>
              ))}
              {sessions.length > 1 && (
                <div className="pt-3 text-center">
                  <Button variant="destructive" size="sm" className="text-xs" onClick={revokeAll} disabled={revoking}>
                    {revoking ? <Loader2 className="size-3 animate-spin me-1.5" /> : <LogOut className="size-3 me-1.5 rtl:-scale-x-100" />}
                    {t('profile.action.revokeAllOtherSessions')}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

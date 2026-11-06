import { useState, useEffect } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/lib/i18n';
import { timeAgo } from '@/lib/helpers';
import { roleLabel } from '@/lib/workspace-dashboard';
import { SectionSkeleton, type Workspace } from './shared';

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);

  useEffect(() => {
    void req<{ ok: boolean; workspaces: Workspace[] }>('/api/workspaces').then((res) => {
      setWorkspaces(res.ok ? res.workspaces : []);
    });
  }, []);

  if (workspaces === null) return <SectionSkeleton />;
  return <WorkspacesSection workspaces={workspaces} />;
}

// ── Workspaces ─────────────────────────────────────────────

export function WorkspacesSection({ workspaces }: { workspaces: Workspace[] }) {
  const t = useT();
  return (
    <section id="section-workspaces">
      <h2 className="text-base font-semibold mb-3">{t('profile.heading.myWorkspaces')}</h2>
      <Card>
        <CardContent>
          {workspaces.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('profile.label.noWorkspaces')}</p>
          ) : (
            workspaces.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-3 border-b last:border-b-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: w.icon_color }}>
                  {w.icon_initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{w.name}</p>
                  <p className="text-[11px] text-muted-foreground">{t('profile.label.joinedWjoinedAt', { wJoined_at: timeAgo(w.joined_at) })}</p>
                </div>
                {/* roleLabel, not `role_id === 'owner'`: ids are `role_owner`-
                    style, so this always rendered "Member", including on
                    workspaces you own. */}
                <Badge variant="secondary" className="text-[10px]">{roleLabel(w.role_id)}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </section>
  );
}

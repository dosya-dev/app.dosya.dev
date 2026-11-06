import { useState, useEffect } from 'react';
import { api } from '@/api/client';
import { useWorkspace } from '@/stores/workspace';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Eye, EyeOff, UserMinus, Shield, Loader2, Check } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useT, useLocale } from '@/lib/i18n';

interface HideModalProps {
  open: boolean;
  target: { id: string; name: string; type: 'file' | 'folder' } | null;
  onClose: () => void;
  onDone: () => void;
}

type HiddenMode = 'none' | 'everyone' | 'users' | 'roles';

interface Member { user_id: string; name: string; email: string; role_id: string; is_you: boolean }
interface Role { id: string; name: string }

export function HideModal({ open, target, onClose, onDone }: HideModalProps) {
  const t = useT();
  const { locale } = useLocale();
  const wsId = useWorkspace((s: { activeId: string }) => s.activeId);
  const [mode, setMode] = useState<HiddenMode>('none');
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !target) return;
    setError('');
    setFetching(true);

    const ep = target.type === 'file' ? `/api/files/${target.id}/hide` : `/api/folders/${target.id}/hide`;

    Promise.all([
      api<{ ok: boolean; hidden_mode?: string; rules?: { target_id: string }[] }>(ep),
      api<{ ok: boolean; members?: Member[] }>(`/api/team?workspace_id=${wsId}`),
      api<{ ok: boolean; roles?: Role[] }>(`/api/roles?workspace_id=${wsId}`),
    ]).then(([hideData, teamData, rolesData]) => {
      if (hideData.ok) {
        setMode((hideData.hidden_mode ?? 'none') as HiddenMode);
        setSelectedTargets(new Set((hideData.rules ?? []).map((r) => r.target_id)));
      }
      if (teamData.ok && teamData.members) setMembers(teamData.members);
      if (rolesData.ok && rolesData.roles) setRoles(rolesData.roles);
    }).catch(() => {}).finally(() => setFetching(false));
  }, [open, target, wsId]);

  const toggleTarget = (id: string) => {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!target) return;
    setError('');
    setLoading(true);
    const ep = target.type === 'file' ? `/api/files/${target.id}/hide` : `/api/folders/${target.id}/hide`;
    try {
      const body: Record<string, unknown> = { hidden_mode: mode };
      if (mode === 'users' || mode === 'roles') {
        if (selectedTargets.size === 0) {
          setError(t('files.error.selectAtLeastOneModeusersSelectTrueUserOtherRole', { modeUsers: mode === 'users' ? 'true' : 'false' }));
          setLoading(false);
          return;
        }
        body.targets = Array.from(selectedTargets);
      }
      const res = await api<{ ok: boolean; error?: string }>(ep, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(mode === 'none' ? t('files.feedback.fileUnhidden') : t('files.feedback.fileHidden'), mode === 'none' ? t('files.feedback.thisFileIsNowVisibleToEveryone') : t('files.feedback.thisFileIsNowHidden'));
        onDone();
        onClose();
      } else {
        setError(res.error ?? t('common.error.failed'));
      }
    } catch {
      setError(t('file-security.error.failedToUpdateVisibility'));
    }
    setLoading(false);
  };

  // You can't hide your own files from yourself or your own role - still shown, but disabled.
  const myRoleId = members.find((m) => m.is_you)?.role_id;

  const MODES: { value: HiddenMode; label: string; desc: string; icon: React.ReactNode }[] = [
    { value: 'none', label: t('files.label.visible'), desc: t('files.description.everyoneCanSeeThis'), icon: <Eye className="size-4 text-muted-foreground" /> },
    { value: 'everyone', label: t('file-security.label.hiddenFromEverybody'), desc: t('files.description.onlyYouCanSeeThis'), icon: <EyeOff className="size-4 text-red-500" /> },
    { value: 'users', label: t('file-security.label.hiddenFromSpecificUsers'), desc: t('files.error.selectWhichUsersCanTSeeThis'), icon: <UserMinus className="size-4 text-blue-500" /> },
    { value: 'roles', label: t('file-security.label.hiddenFromSpecificRoles'), desc: t('files.error.selectWhichRolesCanTSeeThis'), icon: <Shield className="size-4 text-violet-500" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('files.heading.hideTargettype', { targetType: target ? (target.type === 'file' ? t('common.label.fileTitleCase') : t('common.label.folder')).toLocaleLowerCase(locale) : '' })}</DialogTitle>
        </DialogHeader>

        {fetching ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-2">
            <RadioGroup value={mode} onValueChange={(v) => { setMode(v as HiddenMode); setSelectedTargets(new Set()); }}>
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${mode === m.value ? 'border-foreground bg-muted/50' : 'hover:bg-muted/30'}`}
                >
                  <RadioGroupItem value={m.value} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">{m.icon} {m.label}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>

            {/* User picker */}
            {mode === 'users' && (
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {members.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">{t('file-security.empty.noMembersFound')}</p>
                ) : members.map((m) => (
                  <button
                    key={m.user_id}
                    disabled={m.is_you}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs border-b last:border-b-0 text-start ${m.is_you ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/50'} ${selectedTargets.has(m.user_id) ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                    onClick={() => { if (!m.is_you) toggleTarget(m.user_id); }}
                  >
                    {selectedTargets.has(m.user_id) && <Check className="size-3 text-blue-600 shrink-0" />}
                    <span className="flex-1 truncate">{m.name}{m.is_you && ` ${t('files.action.you')}`}</span>
                    <span className="text-muted-foreground truncate">{m.email}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Role picker */}
            {mode === 'roles' && (
              <div className="border rounded-lg max-h-40 overflow-y-auto">
                {roles.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">{t('file-security.empty.noRolesFound')}</p>
                ) : roles.map((r) => {
                  const isMine = r.id === myRoleId;
                  return (
                  <button
                    key={r.id}
                    disabled={isMine}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs border-b last:border-b-0 text-start ${isMine ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted/50'} ${selectedTargets.has(r.id) ? 'bg-violet-50 dark:bg-violet-950/30' : ''}`}
                    onClick={() => { if (!isMine) toggleTarget(r.id); }}
                  >
                    {selectedTargets.has(r.id) && <Check className="size-3 text-violet-600 shrink-0" />}
                    <span className="flex-1 truncate">{r.name}{isMine && ` ${t('files.action.yourRole')}`}</span>
                  </button>
                  );
                })}
              </div>
            )}

            {(mode === 'users' || mode === 'roles') && selectedTargets.size > 0 && (
              <p className="text-xs text-muted-foreground">{t('common.label.totalselectedSelected', { totalSelected: selectedTargets.size })}</p>
            )}

            {error && (
              <p dir="auto" className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={loading || fetching}>
            {loading && <Loader2 className="size-4 animate-spin me-1.5" />}
            {t('common.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

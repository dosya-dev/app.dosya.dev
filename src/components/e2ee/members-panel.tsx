import { useEffect, useState } from 'react';
import { useE2ee, type WorkspaceMember } from '@/stores/e2ee';
import { api } from '@/api/client';
import { useT } from '@/lib/i18n';
import { richText } from '@/lib/rich-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Users, UserPlus, Trash2, ShieldAlert } from 'lucide-react';

/**
 * Members panel for an open encrypted workspace: list members, invite by
 * email, revoke a member - plus the mandatory spec §11 (TOFU) and §8
 * (honest-removal) disclosures. Per the P2c plan, invite/revoke are shown for
 * every member (founder or invitee) - the engine's grantAccess/revokeAccess
 * only require workspace membership, and the server is the actual gate; this
 * is deliberately not re-implemented client-side (see plan's "Notes for the
 * executor").
 */
export function MembersPanel({
  open,
  onOpenChange,
  workspaceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceName: string;
}) {
  const t = useT();
  const members = useE2ee((s) => s.members);
  const busy = useE2ee((s) => s.busy);
  const inviteMember = useE2ee((s) => s.inviteMember);
  const revokeMember = useE2ee((s) => s.revokeMember);

  const [email, setEmail] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceMember | null>(null);
  // Best-effort "you" marker - /api/me is the same lightweight endpoint the
  // Comments/Teams pages already call for current-user identity. Failure is
  // silent: the panel is fully usable without it, it just skips the badge.
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    api<{ user: { id: string } }>('/api/me')
      .then((d) => setCurrentUserId(d.user.id))
      .catch(() => {});
  }, [open]);

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    await inviteMember(trimmed);
    if (!useE2ee.getState().error) setEmail('');
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    await revokeMember(revokeTarget.userId, revokeTarget.ed25519Pub);
    setRevokeTarget(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4" /> {t('vault.heading.membersWorkspacename', { workspaceName })}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {members.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">{t('vault.label.noMembersYet')}</p>
            ) : (
              members.map((m) => {
                const isYou = currentUserId != null && m.userId === currentUserId;
                return (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm">{m.email}</span>
                      {isYou && <Badge variant="secondary" className="text-[9px]">{t('common.status.you')}</Badge>}
                    </div>
                    {!isYou && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-destructive hover:text-destructive"
                        disabled={busy}
                        onClick={() => setRevokeTarget(m)}
                        title={t('vault.action.revokeAccess')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <p>
              {t('vault.description.accessIsGrantedByTrustOnFirstUseVerify')}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <Input
              type="email"
              placeholder={t('vault.placeholder.teammateExampleCom')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
              disabled={busy}
              className="min-w-0"
            />
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={handleInvite}
              disabled={busy || !email.trim()}
            >
              <UserPlus className="size-3.5" /> {t('common.action.invite')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(o) => { if (!o) setRevokeTarget(null); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('vault.heading.revokeAccess')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {richText(
              t('vault.description.revokeRevoketargetemailSAccessToLdquoWorkspacenameRdquo'),
              {
                revokeTargetEmail: <span className="font-semibold text-foreground">{revokeTarget?.email}</span>,
                workspaceName,
              },
            )}
          </p>
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <p>
              {t('vault.description.revokingReKeysThisSpaceSoFutureContentIs')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" className="gap-1.5" onClick={handleRevoke} disabled={busy}>
              <Trash2 className="size-3.5" /> {t('common.action.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useState, useEffect } from 'react';
import { req } from '@/api/req';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/lib/toast';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';
import { enableWebPush } from '@/lib/web-push';

// ── Notifications ──────────────────────────────────────────

/**
 * The switch list is NOT declared here.
 *
 * It used to be - 18 hard-coded legacy type keys, of which the server had
 * stopped storing a single one. Desktop and mobile each carried their own copy
 * of the same list, and they disagreed: mobile showed three toggles this file
 * had never heard of. The list now comes from GET /api/me/notifications, which
 * is the only place that knows what the delivery gate actually reads.
 */
interface NotifGroup {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  alwaysOn: 'all' | 'some' | 'none';
  note: string | null;
  options: { key: string; label: string; description: string; enabled: boolean }[];
}

// Labels are catalog keys, translated at render. "In-app" has no catalog entry
// (uncatalogued), so its slot holds null and renders the English literal.
const CHANNELS: readonly (readonly [string, MessageKey | null])[] = [
  ['in_app', null],
  ['email', 'common.label.email'],
  ['push', 'profile.label.browserPush'],
];

export function NotificationsSection() {
  const t = useT();
  const [groups, setGroups] = useState<NotifGroup[] | null>(null);
  const [channels, setChannels] = useState<Record<string, boolean>>({ in_app: true, email: true, push: true });

  useEffect(() => {
    (async () => {
      const res = await req<{ ok: boolean; groups?: NotifGroup[]; channels?: Record<string, boolean> }>('/api/me/notifications');
      setGroups(res.ok && res.groups ? res.groups : []);
      const loadedChannels = res.ok ? res.channels : undefined;
      if (loadedChannels) setChannels((c) => ({ ...c, ...loadedChannels }));
    })();
  }, []);

  /** Moves one switch, optimistically, and puts it back if the server refuses. */
  const setValue = (key: string, value: boolean) =>
    setGroups((gs) => (gs ?? []).map((g) => (
      g.key === key
        ? { ...g, enabled: value }
        : { ...g, options: g.options.map((o) => (o.key === key ? { ...o, enabled: value } : o)) }
    )));

  // ONE key per PUT, never the whole map. A whole-map write is a stale-map
  // race between two open sessions: whatever the other one changed comes back
  // at the value this page loaded with.
  const toggle = async (key: string, next: boolean) => {
    setValue(key, next);
    const res = await req('/api/me/notifications', {
      method: 'PUT', body: JSON.stringify({ preferences: { [key]: next } }),
    });
    if (!res.ok) {
      setValue(key, !next);
      toast.error(t('common.error.couldnTSave'), res.error ?? t('profile.error.yourNotificationPreferenceCouldNotBeSaved'));
    }
  };

  const toggleChannel = async (key: string, next: boolean) => {
    setChannels((c) => ({ ...c, [key]: next }));
    const res = await req('/api/me/notifications', {
      method: 'PUT', body: JSON.stringify({ channels: { [key]: next } }),
    });
    if (!res.ok) {
      setChannels((c) => ({ ...c, [key]: !next }));
      toast.error(t('common.error.couldnTSave'), res.error ?? t('profile.error.yourChannelPreferenceCouldNotBeSaved'));
    }
  };

  const handleEnablePush = async () => {
    const r = await enableWebPush();
    if (r === 'enabled') toast.success(t('profile.feedback.browserNotificationsEnabled'));
    else if (r === 'denied') toast.error(t('profile.error.permissionDenied'), t('profile.error.allowNotificationsInYourBrowserSettings'));
    else toast.error(t('profile.error.notSupported'), t('profile.error.thisBrowserCanTReceiveWebPush'));
  };

  const loading = groups === null;

  return (
    <section id="section-notifications">
      <h2 className="text-base font-semibold mb-3">{t('common.heading.notifications')}</h2>
      <Card>
        <CardContent>
          <div className="mb-6">
            <h3 className="text-sm font-medium mb-2">{t('profile.heading.deliveryChannels')}</h3>
            {CHANNELS.map(([key, labelKey]) => (
              <div key={key} className="flex items-center justify-between py-2">
                <span className="text-sm">{labelKey ? t(labelKey) : t('profile.label.inApp')}</span>
                <Toggle
                  checked={channels[key] ?? true}
                  onChange={(v) => toggleChannel(key, v)}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-sm px-3 py-1.5 rounded-md border hover:bg-muted mt-2"
              onClick={handleEnablePush}
            >
              {t('profile.action.enableBrowserNotifications')}
            </button>
          </div>
          {(groups ?? []).map((g) => (
            <div key={g.key} className="flex flex-col gap-2 py-3 border-b last:border-b-0" data-testid={`notif-group-${g.key}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{g.label}</p>
                  <p className="text-[11px] text-muted-foreground">{g.description}</p>
                  {/* Some of these send regardless of the switch. Say so here
                      rather than let the switch imply otherwise. */}
                  {g.note && <p className="text-[11px] text-muted-foreground italic mt-0.5">{g.note}</p>}
                </div>
                {g.alwaysOn === 'all' ? (
                  <span className="text-[11px] text-muted-foreground shrink-0">{t('profile.label.alwaysOn')}</span>
                ) : (
                  <Toggle
                    checked={g.enabled}
                    disabled={loading}
                    onChange={(v) => toggle(g.key, v)}
                  />
                )}
              </div>
              {g.options.length > 0 && (
                <div className="ps-4 border-s ms-1">
                  {g.options.map((o) => (
                    <div key={o.key} className="flex items-center justify-between gap-4 py-1.5">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium">{o.label}</p>
                        <p className="text-[11px] text-muted-foreground">{o.description}</p>
                      </div>
                      <Toggle
                        checked={o.enabled}
                        // A sub-switch under a group that is off can only lie:
                        // the group gate runs first.
                        disabled={loading || !g.enabled}
                        onChange={(v) => toggle(o.key, v)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-green-600' : 'bg-muted-foreground/30'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`absolute top-[2px] w-4 h-4 bg-white rounded-full shadow transition-all ${checked ? 'inset-s-[18px]' : 'inset-s-[2px]'}`} />
    </button>
  );
}

export default NotificationsSection;

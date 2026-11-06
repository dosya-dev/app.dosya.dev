import { Info, Shield, Lock, Sparkles, Users, AlertTriangle, type LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import type { MessageKey } from '@/i18n/keys';

export type SettingsSectionId = 'info' | 'limits' | 'security' | 'ai' | 'roles' | 'danger';

interface SettingsSection {
  id: SettingsSectionId;
  /** Catalog keys. The table holds keys; `label` and `group` translate when read. */
  labelKey: MessageKey;
  groupKey: MessageKey;
  readonly label: string;
  /** Stable English group id, matched by settings.tsx. Show `groupKey` translated instead. */
  group: 'General' | 'Members' | 'Danger';
  icon: LucideIcon;
  danger?: boolean;
}

function section(
  id: SettingsSectionId, labelKey: MessageKey, icon: LucideIcon, group: SettingsSection['group'], groupKey: MessageKey, danger?: boolean,
): SettingsSection {
  return {
    id, labelKey, group, groupKey, icon,
    get label() { return t(labelKey); },
    ...(danger ? { danger } : {}),
  };
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  section('info', 'settings.label.workspaceInfo', Info, 'General', 'settings.label.general'),
  section('limits', 'settings.label.hardLimits', Shield, 'General', 'settings.label.general'),
  section('security', 'common.label.security', Lock, 'General', 'settings.label.general'),
  section('ai', 'settings.label.aiSearch', Sparkles, 'General', 'settings.label.general'),
  section('roles', 'settings.label.rolesPermissions', Users, 'Members', 'common.label.members'),
  section('danger', 'settings.label.dangerZone', AlertTriangle, 'Danger', 'settings.label.danger', true),
];

/** `#section-security` -> 'security'; anything else -> null. Search links land here. */
export function sectionFromHash(hash: string): SettingsSectionId | null {
  const m = /^#section-([a-z]+)$/.exec(hash);
  return m && SETTINGS_SECTIONS.some((s) => s.id === m[1]) ? (m[1] as SettingsSectionId) : null;
}

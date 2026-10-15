import { Info, Shield, Lock, Users, AlertTriangle, type LucideIcon } from 'lucide-react';

export type SettingsSectionId = 'info' | 'limits' | 'security' | 'roles' | 'danger';

export const SETTINGS_SECTIONS: readonly { id: SettingsSectionId; label: string; icon: LucideIcon; group: string; danger?: boolean }[] = [
  { id: 'info', label: 'Workspace info', icon: Info, group: 'General' },
  { id: 'limits', label: 'Hard limits', icon: Shield, group: 'General' },
  { id: 'security', label: 'Security', icon: Lock, group: 'General' },
  { id: 'roles', label: 'Roles & permissions', icon: Users, group: 'Members' },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle, group: 'Danger', danger: true },
];

/** `#section-security` -> 'security'; anything else -> null. Search links land here. */
export function sectionFromHash(hash: string): SettingsSectionId | null {
  const m = /^#section-([a-z]+)$/.exec(hash);
  return m && SETTINGS_SECTIONS.some((s) => s.id === m[1]) ? (m[1] as SettingsSectionId) : null;
}

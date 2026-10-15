import type { LucideIcon } from 'lucide-react';

export type SearchKind = 'goto' | 'integration' | 'help';

export interface SearchItem {
  /** Stable id, e.g. 'goto:billing', 'integration:wordpress', 'help:api-key'. */
  id: string;
  kind: SearchKind;
  title: string;
  /** Small grey line under the title, e.g. "Profile" or an integration's description. */
  context?: string;
  /** Searched but not shown as the main line (help article summary). */
  summary?: string;
  /** In-app path, or an absolute URL when `external`. */
  href: string;
  external?: boolean;
  /** Synonyms, matched but never displayed. */
  keywords?: string[];
  /** Workspace permission required, same names RequirePermission uses. */
  perm?: string;
  icon?: LucideIcon;
  iconSrc?: string;
}

export interface Ranked {
  topHit: SearchItem | null;
  goto: SearchItem[];
  integration: SearchItem[];
  help: SearchItem[];
}
